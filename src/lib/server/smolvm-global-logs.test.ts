import { expect, test } from 'bun:test';
import {
  createSmolVmClient,
  type SmolVmStreamTransport,
  type SmolVmTransport
} from './smolvm-client';
import { createGlobalLogsSseResponse } from './smolvm-global-logs';

type SseEvent = {
  readonly event: string;
  readonly machine?: unknown;
  readonly line?: unknown;
  readonly name?: unknown;
  readonly state?: unknown;
  readonly dropped?: unknown;
};

type PushStream = {
  readonly stream: AsyncIterable<Uint8Array>;
  readonly push: (text: string) => void;
  readonly end: () => void;
};

const encoder = new TextEncoder();

function createPushStream(): PushStream {
  const chunks: Uint8Array[] = [];
  let wake: (() => void) | undefined;
  let ended = false;

  return {
    stream: (async function* () {
      while (!ended || chunks.length > 0) {
        const chunk = chunks.shift();
        if (chunk) {
          yield chunk;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
    })(),
    push(text) {
      chunks.push(encoder.encode(text));
      wake?.();
      wake = undefined;
    },
    end() {
      ended = true;
      wake?.();
      wake = undefined;
    }
  };
}

function machineNameFromPath(path: string): string {
  const match = path.match(/\/machines\/([^/]+)\/logs/);
  if (!match?.[1]) throw new Error(`Unexpected log path: ${path}`);
  return decodeURIComponent(match[1]);
}

function parseEvent(block: string): SseEvent | undefined {
  const event = block.match(/^event: (.+)$/m)?.[1];
  const data = block.match(/^data: (.+)$/m)?.[1];
  if (!event || !data) return undefined;

  const payload: unknown = JSON.parse(data);
  if (!payload || typeof payload !== 'object') return { event };

  return {
    event,
    ...('machine' in payload ? { machine: payload.machine } : {}),
    ...('line' in payload ? { line: payload.line } : {}),
    ...('name' in payload ? { name: payload.name } : {}),
    ...('state' in payload ? { state: payload.state } : {}),
    ...('dropped' in payload ? { dropped: payload.dropped } : {})
  };
}

async function readEvents(response: Response, until: (events: readonly SseEvent[]) => boolean) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('SSE response has no body.');

  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  let buffered = '';

  while (!until(events)) {
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

  await reader.cancel();
  return events;
}

function authenticatedContext(client: ReturnType<typeof createSmolVmClient>) {
  return {
    locals: { admin: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' } },
    request: new Request('http://local/api/smolvm/logs'),
    url: new URL('http://local/api/smolvm/logs'),
    client
  };
}

test('global logs interleave machine-tagged events from multiple streams', async () => {
  const streams = new Map([
    ['vm1', createPushStream()],
    ['vm2', createPushStream()]
  ]);
  const transport: SmolVmTransport = async () => ({
    status: 200,
    headers: {},
    body: JSON.stringify({ machines: [{ name: 'vm1' }, { name: 'vm2' }] })
  });
  const streamTransport: SmolVmStreamTransport = async (_socketPath, options) => {
    const name = machineNameFromPath(options.path);
    const controlled = streams.get(name);
    if (!controlled) throw new Error(`Missing stream for ${name}`);
    return { status: 200, headers: {}, stream: controlled.stream, close: controlled.end };
  };
  const response = await createGlobalLogsSseResponse(
    authenticatedContext(createSmolVmClient({ transport, streamTransport }))
  );

  streams.get('vm1')?.push('one\n');
  streams.get('vm2')?.push('two\n');
  await Promise.resolve();
  streams.get('vm1')?.push('three\n');
  const events = await readEvents(
    response,
    (received) => received.filter((event) => event.event === 'log').length === 3
  );
  const logs = events.filter((event) => event.event === 'log');

  expect(logs[0]?.machine).toBe('vm1');
  expect(logs.map(({ machine, line }) => ({ machine, line }))).toEqual([
    { machine: 'vm1', line: 'one' },
    { machine: 'vm2', line: 'two' },
    { machine: 'vm1', line: 'three' }
  ]);
});

test('global logs add a machine discovered during re-poll', async () => {
  const vm1 = createPushStream();
  const vm2 = createPushStream();
  let listCount = 0;
  const transport: SmolVmTransport = async () => {
    listCount += 1;
    return {
      status: 200,
      headers: {},
      body: JSON.stringify({
        machines: listCount === 1 ? [{ name: 'vm1' }] : [{ name: 'vm1' }, { name: 'vm2' }]
      })
    };
  };
  const streamTransport: SmolVmStreamTransport = async (_socketPath, options) => {
    const controlled = machineNameFromPath(options.path) === 'vm1' ? vm1 : vm2;
    return { status: 200, headers: {}, stream: controlled.stream, close: controlled.end };
  };
  const realSetInterval = globalThis.setInterval;
  Object.defineProperty(globalThis, 'setInterval', {
    configurable: true,
    writable: true,
    value(callback: TimerHandler) {
      queueMicrotask(() => {
        if (typeof callback === 'function') callback();
      });
      return 1;
    }
  });

  try {
    const response = await createGlobalLogsSseResponse(
      authenticatedContext(createSmolVmClient({ transport, streamTransport }))
    );
    const events = await readEvents(response, (received) =>
      received.some((event) => event.event === 'machine' && event.name === 'vm2')
    );

    expect(events).toContainEqual({ event: 'machine', name: 'vm2', state: 'added' });
  } finally {
    Object.defineProperty(globalThis, 'setInterval', {
      configurable: true,
      writable: true,
      value: realSetInterval
    });
  }
});

test('global logs emit a gap event when one machine queue overflows', async () => {
  const lines = Array.from({ length: 205 }, (_, index) => `line-${index}`).join('\n') + '\n';
  const transport: SmolVmTransport = async () => ({
    status: 200,
    headers: {},
    body: JSON.stringify({ machines: [{ name: 'vm1' }] })
  });
  const streamTransport: SmolVmStreamTransport = async () => ({
    status: 200,
    headers: {},
    stream: (async function* () {
      yield encoder.encode(lines);
      await new Promise<void>(() => undefined);
    })(),
    close: () => undefined
  });
  const response = await createGlobalLogsSseResponse(
    authenticatedContext(createSmolVmClient({ transport, streamTransport }))
  );
  const events = await readEvents(response, (received) =>
    received.some((event) => event.event === 'gap')
  );

  expect(events.find((event) => event.event === 'gap')).toEqual({
    event: 'gap',
    machine: 'vm1',
    dropped: 5
  });
});
