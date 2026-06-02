import { existsSync } from 'node:fs';
import { beforeEach, expect, test } from 'bun:test';
import { requireSmolVmAdmin, placeholderStatus } from './smolvm-api';
import {
  DEFAULT_SMOLVM_SOCKET,
  SMOLVM_ERROR_CODES,
  SmolVmError,
  createSmolVmClient,
  normalizeSmolVmError,
  type SmolVmClient,
  type SmolVmRequestOptions,
  type SmolVmTransport
} from './smolvm-client';

function response(
  status: number,
  body: unknown
): { status: number; headers: Record<string, string | undefined>; body: string } {
  return {
    status,
    headers: {},
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

function createCapturingTransport(body: unknown = { status: 'ok' }) {
  const calls: Array<{ socketPath: string; options: SmolVmRequestOptions }> = [];
  const transport: SmolVmTransport = async (socketPath, options) => {
    calls.push({ socketPath, options });
    return response(200, body);
  };
  return { calls, transport };
}

beforeEach(() => {
  delete process.env.SMOLVM_SOCKET;
});

test('smolvm-client uses default socket and constructs health request', async () => {
  const { calls, transport } = createCapturingTransport({ status: 'ok', version: '0.8.1' });
  const client = createSmolVmClient({ transport });

  const health = await client.getHealth();

  expect(client.socketPath).toBe(DEFAULT_SMOLVM_SOCKET);
  expect(health.status).toBe('ok');
  expect(calls).toEqual([
    {
      socketPath: DEFAULT_SMOLVM_SOCKET,
      options: { method: 'GET', path: '/health' }
    }
  ]);
});

test('smolvm-client honors SMOLVM_SOCKET configuration', () => {
  process.env.SMOLVM_SOCKET = '/run/custom-smolvm.sock';

  const client = createSmolVmClient({ transport: async () => response(200, { status: 'ok' }) });

  expect(client.socketPath).toBe('/run/custom-smolvm.sock');
});

test('smolvm-client constructs typed machine action requests', async () => {
  const { calls, transport } = createCapturingTransport({ ok: true });
  const client = createSmolVmClient({ socketPath: '/tmp/test.sock', transport });

  await client.startMachine('vm one');
  await client.stopMachine('vm/one');
  await client.deleteMachine('vm:one');

  expect(calls.map((call) => call.options)).toEqual([
    { method: 'POST', path: '/api/v1/machines/vm%20one/start' },
    { method: 'POST', path: '/api/v1/machines/vm%2Fone/stop' },
    { method: 'DELETE', path: '/api/v1/machines/vm%3Aone' }
  ]);
});

test('smolvm-client parses machine list JSON', async () => {
  const client = createSmolVmClient({
    transport: async () => response(200, { machines: [{ name: 'alpha', status: 'running' }] })
  });

  const result = await client.listMachines();

  expect(result.machines).toHaveLength(1);
  expect(result.machines[0].name).toBe('alpha');
});

test('smolvm-client normalizes invalid JSON as bad response', async () => {
  const client = createSmolVmClient({
    transport: async () => ({ status: 200, headers: {}, body: 'not-json' })
  });

  await expect(client.getCapacity()).rejects.toMatchObject({
    code: SMOLVM_ERROR_CODES.BAD_RESPONSE,
    status: 502
  });
});

test('smolvm-client normalizes socket failures as unreachable', async () => {
  const client = createSmolVmClient({
    transport: async () => {
      throw new Error('connect ENOENT');
    }
  });

  await expect(client.getHealth()).rejects.toMatchObject({
    code: SMOLVM_ERROR_CODES.UNREACHABLE,
    status: 503
  });
});

test('smolvm-client normalizes upstream non-2xx responses', async () => {
  const client = createSmolVmClient({
    transport: async () => response(404, { error: 'missing' })
  });

  await expect(client.getMachine('missing')).rejects.toMatchObject({
    code: SMOLVM_ERROR_CODES.REQUEST_FAILED,
    status: 404,
    details: { error: 'missing' }
  });
});

test('smolvm-client exposes stable error JSON without socket internals', () => {
  const normalized = normalizeSmolVmError(
    new SmolVmError(SMOLVM_ERROR_CODES.UNREACHABLE, 'SmolVM is unreachable.', 503)
  );

  expect(normalized).toEqual({
    code: SMOLVM_ERROR_CODES.UNREACHABLE,
    message: 'SmolVM is unreachable.',
    status: 503
  });
});

test('smolvm-client facade returns route-level JSON shape for authenticated calls', async () => {
  const client = {
    getHealth: async () => ({ status: 'ok', version: 'test' })
  } as SmolVmClient;

  const response = await requireSmolVmAdmin(
    { locals: { admin: { id: '1', email: 'admin', name: null } }, client },
    (client) => client.getHealth()
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok', version: 'test' });
});

test('smolvm-client facade returns 401 before client access when unauthenticated', async () => {
  let called = false;
  const client = {
    getHealth: async () => {
      called = true;
      return { status: 'ok' };
    }
  } as SmolVmClient;

  const response = await requireSmolVmAdmin({ locals: {}, client }, (client) => client.getHealth());

  expect(called).toBe(false);
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: 'Unauthorized' });
});

test('smolvm-client placeholder API shape is explicit and not a proxy', async () => {
  const client = createSmolVmClient({ transport: async () => response(200, { status: 'ok' }) });
  const apiResponse = placeholderStatus(client.getImagesPlaceholder());

  expect(apiResponse.status).toBe(501);
  expect(await apiResponse.json()).toEqual({
    available: false,
    feature: 'images',
    message: 'SmolVM images support is intentionally typed but not implemented in this task.'
  });
});

if (existsSync(DEFAULT_SMOLVM_SOCKET)) {
  test('smolvm-client real socket smoke: health capacity metrics and machines', async () => {
    const client = createSmolVmClient();

    const health = await client.getHealth();
    const capacity = await client.getCapacity();
    const metrics = await client.getMetrics();
    const machines = await client.listMachines();

    expect(health.status).toBe('ok');
    expect(typeof capacity).toBe('object');
    expect(metrics.length).toBeGreaterThan(0);
    expect(Array.isArray(machines.machines)).toBe(true);
  });
} else {
  test('smolvm-client real socket smoke is skipped when socket is absent', () => {
    expect(existsSync(DEFAULT_SMOLVM_SOCKET)).toBe(false);
  });
}
