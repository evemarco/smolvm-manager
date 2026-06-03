import { beforeEach, expect, test, describe } from 'bun:test';
import {
  createLogsSseResponse,
  createTerminalHandshakeResponse,
  auditTerminalEvent,
  MAX_LOG_TAIL
} from './smolvm-streaming';
import {
  createMockManagerStoreClient,
  getMockAuditEvents,
  resetMockManagerStore,
  STORE_ERROR_CODES
} from './manager-store-client';
import { createSmolVmClient, type SmolVmStreamTransport } from './smolvm-client';
import { createFrameParser, encodeWebSocketFrame } from './smolvm-terminal-ws';

function locals() {
  return { admin: { id: 'admin-1', email: 'admin@example.com', name: 'Admin' } };
}

async function* chunks(values: string[]) {
  const encoder = new TextEncoder();
  for (const value of values) {
    yield encoder.encode(value);
  }
}

async function responseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';

  const decoder = new TextDecoder();
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

beforeEach(() => {
  resetMockManagerStore();
});

test('streaming logs clamps tail and emits SSE without caching full history', async () => {
  let requestedPath = '';
  let closed = false;
  const streamTransport: SmolVmStreamTransport = async (_socketPath, options) => {
    requestedPath = options.path;
    return {
      status: 200,
      headers: {},
      stream: chunks(['one\ntwo\n', 'three']),
      close: () => {
        closed = true;
      }
    };
  };
  const client = createSmolVmClient({ streamTransport });

  const response = await createLogsSseResponse({
    locals: locals(),
    params: { name: 'vm logs' },
    request: new Request('http://local/api', { signal: new AbortController().signal }),
    url: new URL('http://local/api?tail=999999'),
    client
  });

  const text = await responseText(response);

  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(requestedPath).toBe(`/api/v1/machines/vm%20logs/logs?tail=${MAX_LOG_TAIL}`);
  expect(text).toContain(`"tail":${MAX_LOG_TAIL}`);
  expect(text).toContain('"line":"one"');
  expect(text).toContain('"line":"two"');
  expect(text).toContain('"line":"three"');
  expect(closed).toBe(true);
});

test('streaming logs rejects unauthenticated requests before opening SmolVM stream', async () => {
  let opened = false;
  const client = {
    openLogStream: async () => {
      opened = true;
      throw new Error('should not open');
    }
  } as unknown as ReturnType<typeof createSmolVmClient>;

  const response = await createLogsSseResponse({
    locals: {},
    params: { name: 'vm' },
    request: new Request('http://local/api'),
    url: new URL('http://local/api'),
    client
  });

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'Unauthorized' });
  expect(opened).toBe(false);
});

test('terminal handshake rejects unauthenticated requests without audit or PTY side effects', async () => {
  const response = await createTerminalHandshakeResponse({
    locals: {},
    params: { name: 'vm' },
    request: new Request('http://local/api'),
    url: new URL('http://local/api')
  });

  expect(response.status).toBe(401);
  expect(getMockAuditEvents()).toHaveLength(0);
});

test('terminal websocket framing supports stdin resize and PTY output bytes', () => {
  const frames: Array<{ opcode: number; text: string }> = [];
  const parse = createFrameParser((frame) => {
    frames.push({ opcode: frame.opcode, text: frame.payload.toString('utf8') });
  });

  parse(
    encodeWebSocketFrame(
      { opcode: 1, payload: Buffer.from('{"type":"stdin","data":"ls\\n"}') },
      true
    )
  );
  parse(
    encodeWebSocketFrame(
      { opcode: 1, payload: Buffer.from('{"type":"resize","cols":120,"rows":40}') },
      true
    )
  );
  parse(encodeWebSocketFrame({ opcode: 2, payload: Buffer.from('pty output\n') }));

  expect(frames).toEqual([
    { opcode: 1, text: '{"type":"stdin","data":"ls\\n"}' },
    { opcode: 1, text: '{"type":"resize","cols":120,"rows":40}' },
    { opcode: 2, text: 'pty output\n' }
  ]);
});

test('terminal audit stores metadata only and never terminal content', async () => {
  const store = createMockManagerStoreClient();
  await auditTerminalEvent({
    locals: locals(),
    request: new Request('http://local/api', { headers: { 'x-forwarded-for': '10.0.0.1' } }),
    machineName: 'audit-vm',
    action: 'open',
    store
  });
  await auditTerminalEvent({
    locals: locals(),
    request: new Request('http://local/api'),
    machineName: 'audit-vm',
    action: 'error',
    errorCode: 'PTY_CLOSED',
    store
  });

  const events = getMockAuditEvents();
  expect(events).toHaveLength(2);
  expect(events[0].eventType).toBe('terminal.session');
  expect(events[0].action).toBe('terminal.open');
  expect(events[0].actorUserId).toBe('admin-1');
  expect(events[0].ipAddress).toBe('10.0.0.1');
  expect(events[0].details).toBe(JSON.stringify({ machineName: 'audit-vm', event: 'open' }));
  expect(events[1].details).toBe(
    JSON.stringify({ machineName: 'audit-vm', event: 'error', errorCode: 'PTY_CLOSED' })
  );
  expect(JSON.stringify(events)).not.toContain('whoami');
  expect(JSON.stringify(events)).not.toContain('root@');
});

test('terminal route reports upgrade limitation after authenticated metadata audit', async () => {
  const response = await createTerminalHandshakeResponse({
    locals: locals(),
    params: { name: 'term-vm' },
    request: new Request('http://local/api'),
    url: new URL('http://local/api'),
    store: createMockManagerStoreClient()
  });

  expect(response.status).toBe(426);
  expect(response.headers.get('upgrade')).toBe('websocket');
  expect(await response.json()).toMatchObject({ code: 'WEBSOCKET_UPGRADE_REQUIRED' });
  const events = getMockAuditEvents();
  expect(events).toHaveLength(1);
  expect(events[0].action).toBe('terminal.error');
  expect(events[0].details).toBe(
    JSON.stringify({
      machineName: 'term-vm',
      event: 'error',
      errorCode: 'WEBSOCKET_UPGRADE_UNAVAILABLE'
    })
  );
});

describe('service auth context', () => {
  test('background audit write succeeds with service token', async () => {
    const originalToken = process.env.PYLON_SERVICE_TOKEN;
    process.env.PYLON_SERVICE_TOKEN = 'test-service-token';
    resetMockManagerStore();
    const store = createMockManagerStoreClient({ enforcePolicies: true });

    try {
      await auditTerminalEvent({
        locals: locals(),
        request: new Request('http://local/api'),
        machineName: 'audit-vm',
        action: 'open',
        store
      });

      const events = getMockAuditEvents();
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe('terminal.open');
    } finally {
      if (originalToken === undefined) {
        delete process.env.PYLON_SERVICE_TOKEN;
      } else {
        process.env.PYLON_SERVICE_TOKEN = originalToken;
      }
    }
  });

  test('background audit write fails without service token when policies are enforced', async () => {
    const originalToken = process.env.PYLON_SERVICE_TOKEN;
    delete process.env.PYLON_SERVICE_TOKEN;
    resetMockManagerStore();
    const store = createMockManagerStoreClient({ enforcePolicies: true });

    try {
      await expect(
        auditTerminalEvent({
          locals: locals(),
          request: new Request('http://local/api'),
          machineName: 'audit-vm',
          action: 'open',
          store
        })
      ).rejects.toMatchObject({
        code: STORE_ERROR_CODES.REQUEST_FAILED,
        status: 403
      });

      expect(getMockAuditEvents()).toHaveLength(0);
    } finally {
      if (originalToken === undefined) {
        delete process.env.PYLON_SERVICE_TOKEN;
      } else {
        process.env.PYLON_SERVICE_TOKEN = originalToken;
      }
    }
  });
});
