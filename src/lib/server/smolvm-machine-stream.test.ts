import { expect, test } from 'bun:test';
import { createSmolVmClient, type SmolVmTransport } from './smolvm-client';
import {
  __resetMachineStreamForTests,
  createMachineStreamSseResponse
} from './smolvm-machine-stream';

type SseEvent = {
  readonly event: string;
  readonly data?: Record<string, unknown>;
};

function parseEvent(block: string): SseEvent | undefined {
  const event = block.match(/^event: (.+)$/m)?.[1];
  const data = block.match(/^data: (.+)$/m)?.[1];
  if (!event || !data) return undefined;
  const payload: unknown = JSON.parse(data);
  return {
    event,
    ...(payload && typeof payload === 'object'
      ? { data: payload as Record<string, unknown> }
      : {})
  };
}

function collectEvents(response: Response): { events: SseEvent[] } {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('SSE response has no body.');

  const events: SseEvent[] = [];
  void (async () => {
    const decoder = new TextDecoder();
    let buffered = '';
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      buffered += decoder.decode(result.value, { stream: true });
      const blocks = buffered.split('\n\n');
      buffered = blocks.pop() ?? '';
      for (const block of blocks) {
        const event = parseEvent(block);
        if (event) events.push(event);
      }
    }
  })();

  return { events };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for SSE events.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function authenticatedContext(client: ReturnType<typeof createSmolVmClient>, pollMs = 10) {
  return {
    locals: { admin: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' } },
    request: new Request('http://local/api/smolvm/machines/stream'),
    client,
    pollMs
  };
}

function transportFor(state: { machines: unknown[]; fail?: boolean }): SmolVmTransport {
  return async (_socketPath, options) => {
    if (state.fail) return { status: 500, headers: {}, body: '{"error":"boom"}' };
    if (options.path === '/capacity') {
      return { status: 200, headers: {}, body: JSON.stringify({ host: 'ok' }) };
    }
    return { status: 200, headers: {}, body: JSON.stringify({ machines: state.machines }) };
  };
}

test('machine stream requires an admin session', async () => {
  const response = await createMachineStreamSseResponse({
    locals: {},
    request: new Request('http://local/api/smolvm/machines/stream'),
    client: createSmolVmClient({ transport: transportFor({ machines: [] }) }),
    pollMs: 10
  });
  expect(response.status).toBe(401);
});

test('machine stream pushes a snapshot only when machine state changes', async () => {
  __resetMachineStreamForTests();
  const state = { machines: [{ name: 'vm1', state: 'stopped' }] };
  const response = await createMachineStreamSseResponse(
    authenticatedContext(createSmolVmClient({ transport: transportFor(state) }))
  );
  const { events } = collectEvents(response);

  await waitFor(() => events.filter((event) => event.event === 'snapshot').length === 1);
  expect(events.map((event) => event.event)).toEqual(['ready', 'snapshot']);
  expect(events[1]?.data?.machines).toEqual([{ name: 'vm1', state: 'stopped' }]);

  // Polls continue with identical state: no further snapshot may arrive.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(events.filter((event) => event.event === 'snapshot')).toHaveLength(1);

  state.machines = [{ name: 'vm1', state: 'running' }];
  await waitFor(() => events.filter((event) => event.event === 'snapshot').length === 2);
  const snapshots = events.filter((event) => event.event === 'snapshot');
  expect(snapshots[1]?.data?.machines).toEqual([{ name: 'vm1', state: 'running' }]);
  __resetMachineStreamForTests();
});

test('machine stream emits stream-error on failure and recovers silently', async () => {
  __resetMachineStreamForTests();
  const state: { machines: unknown[]; fail?: boolean } = { machines: [], fail: true };
  const response = await createMachineStreamSseResponse(
    authenticatedContext(createSmolVmClient({ transport: transportFor(state) }))
  );
  const { events } = collectEvents(response);

  await waitFor(() => events.some((event) => event.event === 'stream-error'));
  expect(events.map((event) => event.event)).toEqual(['ready', 'stream-error']);

  state.fail = false;
  state.machines = [{ name: 'vm2', state: 'running' }];
  await waitFor(
    () =>
      events.some((event) => event.event === 'snapshot') &&
      events.some((event) => event.event === 'recovered')
  );
  const kinds = events.map((event) => event.event);
  expect(kinds).toContain('snapshot');
  expect(kinds).toContain('recovered');
  __resetMachineStreamForTests();
});
