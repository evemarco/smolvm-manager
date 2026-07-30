import { existsSync } from 'node:fs';
import { beforeEach, expect, test } from 'bun:test';
import { requireSmolVmAdmin } from './smolvm-api';
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

const BUSYBOX_IMAGE = {
  reference: 'docker.io/library/busybox:latest',
  digest: 'sha256:abc',
  size: 1,
  architecture: 'amd64',
  os: 'linux',
  layerCount: 1
};

function createImageAwareTransport(machines: unknown[], createdAtPath = '/api/v1/machines') {
  const calls: SmolVmRequestOptions[] = [];
  const transport: SmolVmTransport = async (_socket, options) => {
    calls.push(options);
    if (options.path === createdAtPath || options.path === '/api/v1/machines/alpha') {
      if (options.path === createdAtPath) return response(200, { machines });
      return response(200, (machines as unknown[])[0]);
    }
    if (options.path === '/api/v1/machines/alpha/images') {
      return response(200, { images: [BUSYBOX_IMAGE] });
    }
    return response(404, { error: 'not found' });
  };
  return { calls, transport };
}

test('listMachines enriches machines with the pulled image reference and caches it', async () => {
  const { calls, transport } = createImageAwareTransport([
    { name: 'alpha', state: 'running', createdAt: 100 }
  ]);
  const client = createSmolVmClient({ transport });

  const first = await client.listMachines();
  expect(first.machines[0].image).toBe('docker.io/library/busybox:latest');

  await client.listMachines();
  const imageCalls = calls.filter((c) => c.path === '/api/v1/machines/alpha/images');
  expect(imageCalls).toHaveLength(1);
});

test('listMachines refetches the image when the machine was recreated', async () => {
  const machines = [{ name: 'alpha', state: 'running', createdAt: 100 }];
  const { calls, transport } = createImageAwareTransport(machines);
  const client = createSmolVmClient({ transport });

  await client.listMachines();
  machines[0] = { name: 'alpha', state: 'running', createdAt: 200 };
  await client.listMachines();

  const imageCalls = calls.filter((c) => c.path === '/api/v1/machines/alpha/images');
  expect(imageCalls).toHaveLength(2);
});

test('getMachine enriches the machine with the pulled image reference', async () => {
  const { transport } = createImageAwareTransport([
    { name: 'alpha', state: 'running', createdAt: 100 }
  ]);
  const client = createSmolVmClient({ transport });

  const machine = await client.getMachine('alpha');
  expect(machine.image).toBe('docker.io/library/busybox:latest');
});

test('listMachines still resolves when the images endpoint fails', async () => {
  const transport: SmolVmTransport = async (_socket, options) => {
    if (options.path === '/api/v1/machines') {
      return response(200, { machines: [{ name: 'alpha', state: 'running', createdAt: 100 }] });
    }
    return response(500, { error: 'boom' });
  };
  const client = createSmolVmClient({ transport });

  const result = await client.listMachines();
  expect(result.machines[0].name).toBe('alpha');
  expect(result.machines[0].image).toBeUndefined();
});

test('createMachine caches the requested image for machines that never started', async () => {
  const transport: SmolVmTransport = async (_socket, options) => {
    if (options.path === '/api/v1/machines' && options.method === 'POST') {
      return response(200, { name: 'fresh', state: 'stopped', createdAt: 100 });
    }
    if (options.path === '/api/v1/machines') {
      return response(200, { machines: [{ name: 'fresh', state: 'stopped', createdAt: 100 }] });
    }
    if (options.path === '/api/v1/machines/fresh/images') {
      return response(200, { images: [] });
    }
    return response(404, { error: 'not found' });
  };
  const client = createSmolVmClient({ transport });

  await client.createMachine({ name: 'fresh', image: 'docker.io/library/busybox:latest' });
  const list = await client.listMachines();

  expect(list.machines[0].image).toBe('docker.io/library/busybox:latest');
});

test('getSmolVmClient returns a shared singleton so stream subscribers share one broadcaster', async () => {
  const { getSmolVmClient } = await import('./smolvm-client');
  expect(getSmolVmClient()).toBe(getSmolVmClient());
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
    message: 'missing',
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

test('smolvm-client maps exec files and images to typed SmolVM machine endpoints', async () => {
  const { calls, transport } = createCapturingTransport({
    exitCode: 0,
    stdout: 'ok\n',
    stderr: ''
  });
  const client = createSmolVmClient({ socketPath: '/tmp/test.sock', transport });

  const exec = await client.execMachine('vm one', {
    command: ['echo', 'ok'],
    timeoutSecs: 5,
    env: [{ name: 'A', value: 'B' }]
  });

  expect(exec).toEqual({ exitCode: 0, stdout: 'ok\n', stderr: '' });
  expect(calls).toEqual([
    {
      socketPath: '/tmp/test.sock',
      options: {
        method: 'POST',
        path: '/api/v1/machines/vm%20one/exec',
        body: { command: ['echo', 'ok'], timeoutSecs: 5, env: [{ name: 'A', value: 'B' }] }
      }
    }
  ]);
});

test('smolvm-client downloads guest files through the machine file endpoint', async () => {
  const { calls, transport } = createCapturingTransport('hello');
  const client = createSmolVmClient({ socketPath: '/tmp/test.sock', transport });

  const file = await client.downloadMachineFile('vm/files', '/etc/hosts');

  expect(file).toEqual({ path: '/etc/hosts', content: 'hello', encoding: 'utf-8' });
  expect(calls[0]).toEqual({
    socketPath: '/tmp/test.sock',
    options: {
      method: 'GET',
      path: '/api/v1/machines/vm%2Ffiles/files/etc/hosts',
      responseType: 'text'
    }
  });
});

test('smolvm-client maps image list and pull to machine-scoped SmolVM endpoints', async () => {
  const image = {
    reference: 'alpine:latest',
    digest: 'sha256:abc',
    size: 123,
    architecture: 'amd64',
    os: 'linux',
    layerCount: 2
  };
  const calls: Array<{ socketPath: string; options: SmolVmRequestOptions }> = [];
  const transport: SmolVmTransport = async (socketPath, options) => {
    calls.push({ socketPath, options });
    if (options.method === 'GET') return response(200, { images: [image] });
    return response(200, { image });
  };
  const client = createSmolVmClient({ socketPath: '/tmp/test.sock', transport });

  await expect(client.listMachineImages('vm')).resolves.toEqual({ machine: 'vm', images: [image] });
  await expect(client.pullMachineImage('vm', { image: 'alpine:latest' })).resolves.toEqual({
    machine: 'vm',
    image
  });

  expect(calls.map((call) => call.options)).toEqual([
    { method: 'GET', path: '/api/v1/machines/vm/images' },
    { method: 'POST', path: '/api/v1/machines/vm/images/pull', body: { image: 'alpine:latest' } }
  ]);
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
