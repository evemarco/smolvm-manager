import { expect, test } from 'bun:test';
import {
  createSmolVmClient,
  type SmolVmStreamOptions,
  type SmolVmStreamTransport
} from './smolvm-client';
import { createGuestLogsSseResponse } from './smolvm-guest-logs';

const encoder = new TextEncoder();

async function* chunks(values: readonly string[]): AsyncIterable<Uint8Array> {
  for (const value of values) yield encoder.encode(value);
}

function authenticatedContext(url: string, streamTransport: SmolVmStreamTransport) {
  return {
    locals: { admin: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' } },
    params: { name: 'guest-vm' },
    request: new Request(url),
    url: new URL(url),
    client: createSmolVmClient({ streamTransport })
  };
}

test('guest file logs reject traversal paths before opening an exec stream', async () => {
  const streamTransport: SmolVmStreamTransport = async () => {
    throw new Error('exec stream must not open');
  };
  const res = await createGuestLogsSseResponse(
    authenticatedContext(
      'http://local/api/smolvm/machines/guest-vm/guest-logs?source=file&path=../../etc/passwd',
      streamTransport
    )
  );

  expect(res.status).toBe(400);
});

test('guest file logs reject absolute paths outside var log', async () => {
  const streamTransport: SmolVmStreamTransport = async () => {
    throw new Error('exec stream must not open');
  };
  const res = await createGuestLogsSseResponse(
    authenticatedContext(
      'http://local/api/smolvm/machines/guest-vm/guest-logs?source=file&path=/etc/passwd',
      streamTransport
    )
  );

  expect(res.status).toBe(400);
});

test('guest logs translate stdout and exit from the SmolVM exec stream', async () => {
  let requestOptions: SmolVmStreamOptions | undefined;
  const streamTransport: SmolVmStreamTransport = async (_socketPath, options) => {
    requestOptions = options;
    return {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      stream: chunks([
        'event: stdout\ndata: first line\n\n',
        'event: stdout\ndata: second line\n\nevent: exit\ndata: {"exitCode":0}\n\n'
      ]),
      close: () => undefined
    };
  };
  const res = await createGuestLogsSseResponse(
    authenticatedContext(
      'http://local/api/smolvm/machines/guest-vm/guest-logs?source=file&path=/var/log/app.log&tail=25',
      streamTransport
    )
  );

  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toContain('no-store');
  expect(requestOptions).toMatchObject({
    method: 'POST',
    path: '/api/v1/machines/guest-vm/exec/stream',
    body: { command: ['tail', '-n', '25', '-F', '/var/log/app.log'] }
  });
  expect(await res.text()).toBe(
    'event: line\ndata: {"stream":"stdout","text":"first line"}\n\n' +
      'event: line\ndata: {"stream":"stdout","text":"second line"}\n\n' +
      'event: exit\ndata: {"code":0}\n\n'
  );
});

test('guest logs normalize an upstream non-success response without opening an SSE body', async () => {
  let closed = false;
  const streamTransport: SmolVmStreamTransport = async () => ({
    status: 409,
    headers: { 'content-type': 'application/json' },
    stream: chunks([]),
    close: () => {
      closed = true;
    }
  });
  const res = await createGuestLogsSseResponse(
    authenticatedContext(
      'http://local/api/smolvm/machines/guest-vm/guest-logs?source=journalctl',
      streamTransport
    )
  );

  expect(res.status).toBe(409);
  expect(res.headers.get('content-type')).toContain('application/json');
  expect(await res.json()).toMatchObject({
    code: 'SMOLVM_REQUEST_FAILED',
    status: 409
  });
  expect(closed).toBe(true);
});
