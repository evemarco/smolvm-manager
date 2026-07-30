import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as machinesRoute from './machines/+server';
import * as machinesCreateRoute from './machines/create/+server';
import * as machineRoute from './machines/[name]/+server';
import * as machineStartRoute from './machines/[name]/start/+server';
import * as machineStopRoute from './machines/[name]/stop/+server';
import * as machineCopyRoute from './machines/[name]/copy/+server';
import * as machineRecreateRoute from './machines/[name]/recreate/+server';
import * as machineExecRoute from './machines/[name]/exec/+server';
import * as machineFilesRoute from './machines/[name]/files/+server';
import * as machineLogsRoute from './machines/[name]/logs/+server';
import * as machineTerminalRoute from './machines/[name]/terminal/+server';
import * as machineResizeRoute from './machines/[name]/resize/+server';
import * as machineForkRoute from './machines/[name]/fork/+server';
import * as machineExportRoute from './machines/[name]/export/+server';
import * as machineRunRoute from './machines/[name]/run/+server';
import * as readyzRoute from './readyz/+server';
import * as drainRoute from './drain/+server';
import * as volumesRoute from './volumes/+server';
import * as volumeRoute from './volumes/[id]/+server';
import * as imagesRoute from './images/+server';
import * as healthRoute from './health/+server';
import * as capacityRoute from './capacity/+server';
import * as metricsRoute from './metrics/+server';
import * as metricsHistoryRoute from './metrics/history/+server';
import * as dockerSearchRoute from './docker-hub/search/+server';
import * as dockerTagsRoute from './docker-hub/tags/+server';
import * as tomlValidateRoute from './toml-validate/+server';
import * as tomlGenerateRoute from './toml-generate/+server';
import { GET as getManagerUpdate } from './update/+server';
import { PATCH as patchMachineUpdate } from './machines/[name]/update/+server';
import { SMOLVM_ERROR_CODES, SmolVmError, type SmolVmClient } from '$lib/server/smolvm-client';

const admin = { id: 'admin-1', email: 'admin@example.com', name: null };
const here = fileURLToPath(new URL('.', import.meta.url));
const routeRoot = join(here);

const validVmConfig = {
  name: 'vm-alpha',
  image: 'alpine',
  cpus: 1,
  memory: 64
};

function adminLocals() {
  return { admin };
}

function anonLocals() {
  return {};
}

function jsonRequest(url: string, body: unknown, method = 'POST'): Request {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
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

function walkTsFiles(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return walkTsFiles(fullPath);
    if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      return [fullPath];
    }
    return [];
  });
}

function createSmolVmClientMock() {
  const encoder = new TextEncoder();

  return {
    getHealth: async () => ({ status: 'ok', version: '0.8.1' }),
    getCapacity: async () => ({
      allocated_cpus: 4,
      allocated_memory_mb: 8192,
      used_cpus: 2.5,
      used_memory_mb: 4096,
      used_disk_gb: 50
    }),
    getMetrics: async () =>
      [
        '# TYPE smolvm_machines_running gauge',
        'smolvm_machines_running 2',
        '# TYPE smolvm_machines_total gauge',
        'smolvm_machines_total 5'
      ].join('\n'),
    listMachines: async () => ({ machines: [{ name: 'vm-alpha', state: 'running' }] }),
    getMachine: async (name: string) => ({ name, state: 'running', image: 'alpine:latest' }),
    createMachine: async (body: Record<string, unknown>) => ({
      name: String(body.name),
      image: body.image,
      created: true
    }),
    startMachine: async (name: string) => ({ name, action: 'started' }),
    stopMachine: async (name: string) => ({ name, action: 'stopped' }),
    deleteMachine: async (name: string) => ({ name, action: 'deleted' }),
    openLogStream: async () => ({
      status: 200,
      headers: {},
      stream: (async function* () {
        yield encoder.encode('first\nsecond\n');
        yield encoder.encode('third');
      })(),
      close: () => undefined
    }),
    execMachine: async (name: string, body: { command?: string[] }) => ({
      exitCode: 0,
      stdout: `${name}:${body.command?.join(' ') ?? ''}`,
      stderr: ''
    }),
    downloadMachineFile: async (_name: string, path: string) => ({
      path,
      content: 'hello',
      encoding: 'utf-8' as const
    }),
    listMachineImages: async (machine: string) => ({
      machine,
      images: [
        {
          reference: 'alpine:latest',
          digest: 'sha256:abc',
          size: 1,
          architecture: 'amd64',
          os: 'linux',
          layerCount: 1
        }
      ]
    }),
    pullMachineImage: async (machine: string, body: { image: string }) => ({
      machine,
      image: {
        reference: body.image,
        digest: 'sha256:def',
        size: 2,
        architecture: 'amd64',
        os: 'linux',
        layerCount: 2
      }
    }),
    getReadyz: async () => ({ status: 'ready' }),
    drainNode: async () => ({ drained: true }),
    resizeMachine: async (name: string, body: { storageGb?: number; overlayGb?: number }) => ({
      name,
      resized: body
    }),
    forkMachine: async (name: string, body: { name: string }) => ({
      name: body.name,
      forkedFrom: name
    }),
    exportMachine: async () => ({
      digest: 'sha256:abc',
      sizeBytes: 1234,
      platform: 'linux/amd64',
      manifest: null
    }),
    runMachineImage: async (name: string, body: { command?: string[] }) => ({
      exitCode: 0,
      stdout: `${name}:${body.command?.join(' ') ?? ''}`,
      stderr: ''
    }),
    uploadMachineFile: async (name: string, path: string, content: string) => ({
      name,
      path,
      uploaded: content.length
    }),
    provisionVolume: async (body: { sizeGb: number; backend?: string }) => ({
      id: 'vol-1',
      nodePath: '/var/smolvm/vol-1',
      sizeGb: body.sizeGb,
      ...(body.backend ? { backend: body.backend } : {})
    }),
    deleteVolume: async (id: string) => ({ id, deleted: true })
  };
}

function createMachineUpdateClient(getMachine: SmolVmClient['getMachine']): SmolVmClient {
  return {
    ...createSmolVmClientMock(),
    socketPath: '/tmp/test.sock',
    getMachine,
    execStream: async () => ({
      status: 200,
      headers: {},
      stream: (async function* () {
        yield new Uint8Array();
      })(),
      close: () => undefined
    })
  };
}

function createManagerStoreMock() {
  const auditEvents: Array<{ entry: unknown; auth: unknown }> = [];
  const metricsCalls: Array<{ machineName?: string; limit?: number }> = [];

  return {
    auditEvents,
    metricsCalls,
    insertAuditEvent: async (entry: unknown, auth: unknown) => {
      auditEvents.push({ entry, auth });
      return { id: `audit-${auditEvents.length}` };
    },
    listMetricsSamples: async (machineName?: string, limit?: number) => {
      metricsCalls.push({ machineName, limit });
      return [{ machineName: machineName ?? null, cpu: 1, memoryMb: 2, diskGb: 3 }];
    },
    insertMetricsSample: async (sample: unknown) => sample,
    pruneMetricsSamples: async () => undefined,
    pruneAuditEvents: async () => undefined
  };
}

function installSmolVmClientMock(client: unknown = createSmolVmClientMock()) {
  mock.module('$lib/server/smolvm-client', () => ({
    getSmolVmClient: () => client,
    normalizeSmolVmError: (error: unknown) => {
      const typed = typeof error === 'object' && error !== null ? error : undefined;
      const code = typed && 'code' in typed ? typed.code : undefined;
      const message = typed && 'message' in typed ? typed.message : undefined;
      const status = typed && 'status' in typed ? typed.status : undefined;
      const details = typed && 'details' in typed ? typed.details : undefined;
      return {
        code: typeof code === 'string' ? code : 'SMOLVM_REQUEST_FAILED',
        message:
          typeof message === 'string'
            ? message
            : error instanceof Error
              ? error.message
              : 'SmolVM request failed.',
        status: typeof status === 'number' ? status : 500,
        ...(details === undefined ? {} : { details })
      };
    }
  }));
}

function installManagerStoreMock(store = createManagerStoreMock()) {
  mock.module('$lib/server/manager-store-client', () => ({
    getManagerStoreClient: () => store,
    createServiceAuthContext: () => ({ userId: 'service-token' })
  }));
  return store;
}

function installDockerHubMock() {
  const client = {
    searchRepositories: async (query: string, page: number, pageSize: number) => ({
      results: [{ name: query, namespace: 'library', description: 'mocked' }],
      page,
      pageSize,
      totalCount: 1,
      nextPage: undefined
    }),
    listTags: async (namespace: string, repo: string, page: number, pageSize: number) => ({
      results: [
        {
          name: 'latest',
          digest: 'sha256:tag',
          images: [{ architecture: 'amd64', os: 'linux', digest: 'sha256:tag', size: 1 }]
        }
      ],
      page,
      pageSize,
      totalCount: 1,
      nextPage: undefined
    })
  };

  mock.module('$lib/server/docker-hub', () => ({
    getDockerHubClient: () => client,
    createDockerHubClient: () => client,
    resolveDockerHubToken: async () => undefined,
    normalizeDockerHubError: (error: unknown) => ({
      code: 'DOCKER_HUB_REQUEST_FAILED',
      message: error instanceof Error ? error.message : 'Docker Hub request failed.',
      status: 502
    })
  }));
}

beforeEach(() => {
  mock.restore();
});

afterEach(() => {
  mock.restore();
});

describe('SmolVM facade routes', () => {
  test('route sources never call Pylon query/action APIs', () => {
    const pylonCallPattern = /(pylonFetch|runQuery|runMutation|query\s*\(|action\s*\()/;
    const routeFiles = walkTsFiles(routeRoot);
    const offenders = routeFiles.filter((file) =>
      pylonCallPattern.test(readFileSync(file, 'utf8'))
    );

    expect(routeFiles.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  test('machine lifecycle and machine-operation routes keep auth gates and success shapes', async () => {
    installSmolVmClientMock();
    installManagerStoreMock();

    expect(
      await machinesRoute.GET({ locals: anonLocals() } as Parameters<typeof machinesRoute.GET>[0])
    ).toMatchObject({ status: 401 });

    const listResponse = await machinesRoute.GET({ locals: adminLocals() } as Parameters<
      typeof machinesRoute.GET
    >[0]);
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toEqual({
      machines: [{ name: 'vm-alpha', state: 'running' }]
    });

    expect(
      await machinesCreateRoute.POST({
        locals: anonLocals(),
        request: jsonRequest('http://local/api/smolvm/machines/create', validVmConfig)
      } as Parameters<typeof machinesCreateRoute.POST>[0])
    ).toMatchObject({ status: 401 });

    const createResponse = await machinesCreateRoute.POST({
      locals: adminLocals(),
      request: jsonRequest('http://local/api/smolvm/machines/create', validVmConfig)
    } as Parameters<typeof machinesCreateRoute.POST>[0]);
    expect(createResponse.status).toBe(200);
    expect(await createResponse.json()).toEqual({
      name: 'vm-alpha',
      image: 'alpine',
      created: true
    });

    expect(
      await machineRoute.GET({
        locals: anonLocals(),
        params: { name: 'vm-alpha' }
      } as Parameters<typeof machineRoute.GET>[0])
    ).toMatchObject({ status: 401 });

    const getMachineResponse = await machineRoute.GET({
      locals: adminLocals(),
      params: { name: 'vm-alpha' }
    } as Parameters<typeof machineRoute.GET>[0]);
    expect(getMachineResponse.status).toBe(200);
    expect(await getMachineResponse.json()).toEqual({
      name: 'vm-alpha',
      state: 'running',
      image: 'alpine:latest'
    });

    const deleteMachineResponse = await machineRoute.DELETE({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest('http://local/api/smolvm/machines/vm-alpha', undefined, 'DELETE')
    } as Parameters<typeof machineRoute.DELETE>[0]);
    expect(deleteMachineResponse.status).toBe(200);
    expect(await deleteMachineResponse.json()).toEqual({
      name: 'vm-alpha',
      action: 'deleted'
    });

    const startResponse = await machineStartRoute.POST({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest('http://local/api/smolvm/machines/vm-alpha/start', undefined)
    } as Parameters<typeof machineStartRoute.POST>[0]);
    expect(startResponse.status).toBe(200);
    expect(await startResponse.json()).toEqual({ name: 'vm-alpha', action: 'started' });

    const stopResponse = await machineStopRoute.POST({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest('http://local/api/smolvm/machines/vm-alpha/stop', undefined)
    } as Parameters<typeof machineStopRoute.POST>[0]);
    expect(stopResponse.status).toBe(200);
    expect(await stopResponse.json()).toEqual({ name: 'vm-alpha', action: 'stopped' });

    const execResponse = await machineExecRoute.POST({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest('http://local/api/smolvm/machines/vm-alpha/exec', {
        command: ['echo', 'hello']
      })
    } as Parameters<typeof machineExecRoute.POST>[0]);
    expect(execResponse.status).toBe(200);
    expect(await execResponse.json()).toEqual({
      exitCode: 0,
      stdout: 'vm-alpha:echo hello',
      stderr: ''
    });

    const filesResponse = await machineFilesRoute.GET({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      url: new URL('http://local/api/smolvm/machines/vm-alpha/files?path=%2Fetc%2Fhosts')
    } as Parameters<typeof machineFilesRoute.GET>[0]);
    expect(filesResponse.status).toBe(200);
    expect(await filesResponse.json()).toEqual({
      path: '/etc/hosts',
      content: 'hello',
      encoding: 'utf-8'
    });

    const imagesMissingMachine = await imagesRoute.GET({
      locals: adminLocals(),
      url: new URL('http://local/api/smolvm/images')
    } as Parameters<typeof imagesRoute.GET>[0]);
    expect(imagesMissingMachine.status).toBe(400);
    expect(await imagesMissingMachine.json()).toEqual({
      available: false,
      feature: 'images',
      code: 'SMOLVM_MACHINE_REQUIRED',
      message: 'SmolVM 0.8.1 exposes image cache operations per machine. Supply ?machine=<name>.'
    });

    const imagesListResponse = await imagesRoute.GET({
      locals: adminLocals(),
      url: new URL('http://local/api/smolvm/images?machine=vm-alpha')
    } as Parameters<typeof imagesRoute.GET>[0]);
    expect(imagesListResponse.status).toBe(200);
    expect(await imagesListResponse.json()).toEqual({
      machine: 'vm-alpha',
      images: [
        {
          reference: 'alpine:latest',
          digest: 'sha256:abc',
          size: 1,
          architecture: 'amd64',
          os: 'linux',
          layerCount: 1
        }
      ]
    });

    const imagesPullResponse = await imagesRoute.POST({
      locals: adminLocals(),
      request: jsonRequest('http://local/api/smolvm/images', {
        machine: 'vm-alpha',
        image: 'alpine:latest'
      })
    } as Parameters<typeof imagesRoute.POST>[0]);
    expect(imagesPullResponse.status).toBe(200);
    expect(await imagesPullResponse.json()).toEqual({
      machine: 'vm-alpha',
      image: {
        reference: 'alpine:latest',
        digest: 'sha256:def',
        size: 2,
        architecture: 'amd64',
        os: 'linux',
        layerCount: 2
      }
    });

    const copyResponse = await machineCopyRoute.POST({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest('http://local/api/smolvm/machines/vm-alpha/copy', {
        newName: 'vm-alpha-copy'
      })
    } as Parameters<typeof machineCopyRoute.POST>[0]);
    expect(copyResponse.status).toBe(200);
    expect(await copyResponse.json()).toMatchObject({
      name: 'vm-alpha-copy',
      image: 'alpine:latest',
      created: true
    });

    const recreateResponse = await machineRecreateRoute.POST({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest('http://local/api/smolvm/machines/vm-alpha/recreate', validVmConfig)
    } as Parameters<typeof machineRecreateRoute.POST>[0]);
    expect(recreateResponse.status).toBe(200);
    expect(await recreateResponse.json()).toEqual({
      name: 'vm-alpha',
      image: 'alpine',
      created: true
    });
  });

  test('smolvm 1.7 routes keep auth gates, validation, and success shapes', async () => {
    installSmolVmClientMock();
    const store = installManagerStoreMock();

    expect(
      await readyzRoute.GET({ locals: anonLocals() } as Parameters<typeof readyzRoute.GET>[0])
    ).toMatchObject({ status: 401 });
    const readyzResponse = await readyzRoute.GET({
      locals: adminLocals()
    } as Parameters<typeof readyzRoute.GET>[0]);
    expect(readyzResponse.status).toBe(200);
    expect(await readyzResponse.json()).toEqual({ status: 'ready' });

    expect(
      await drainRoute.POST({ locals: anonLocals() } as Parameters<typeof drainRoute.POST>[0])
    ).toMatchObject({ status: 401 });
    const drainResponse = await drainRoute.POST({
      locals: adminLocals()
    } as Parameters<typeof drainRoute.POST>[0]);
    expect(drainResponse.status).toBe(200);
    expect(await drainResponse.json()).toEqual({ drained: true });

    expect(
      await machineResizeRoute.POST({
        locals: anonLocals(),
        params: { name: 'vm-alpha' },
        request: jsonRequest('http://local/api/smolvm/machines/vm-alpha/resize', {
          storageGb: 20
        })
      } as Parameters<typeof machineResizeRoute.POST>[0])
    ).toMatchObject({ status: 401 });

    const resizeBadResponse = await machineResizeRoute.POST({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest('http://local/api/smolvm/machines/vm-alpha/resize', {
        storageGb: -5
      })
    } as Parameters<typeof machineResizeRoute.POST>[0]);
    expect(resizeBadResponse.status).toBe(400);
    expect(await resizeBadResponse.json()).toMatchObject({ code: 'SMOLVM_RESIZE_INVALID' });

    const resizeResponse = await machineResizeRoute.POST({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest('http://local/api/smolvm/machines/vm-alpha/resize', {
        storageGb: 20
      })
    } as Parameters<typeof machineResizeRoute.POST>[0]);
    expect(resizeResponse.status).toBe(200);
    expect(await resizeResponse.json()).toEqual({
      name: 'vm-alpha',
      resized: { storageGb: 20 }
    });

    expect(
      await machineForkRoute.POST({
        locals: anonLocals(),
        params: { name: 'vm-alpha' },
        request: jsonRequest('http://local/api/smolvm/machines/vm-alpha/fork', { name: 'clone' })
      } as Parameters<typeof machineForkRoute.POST>[0])
    ).toMatchObject({ status: 401 });

    const forkMissingName = await machineForkRoute.POST({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest('http://local/api/smolvm/machines/vm-alpha/fork', { name: '' })
    } as Parameters<typeof machineForkRoute.POST>[0]);
    expect(forkMissingName.status).toBe(400);
    expect(await forkMissingName.json()).toMatchObject({ code: 'SMOLVM_FORK_NAME_REQUIRED' });

    const forkResponse = await machineForkRoute.POST({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest('http://local/api/smolvm/machines/vm-alpha/fork', { name: 'clone' })
    } as Parameters<typeof machineForkRoute.POST>[0]);
    expect(forkResponse.status).toBe(200);
    expect(await forkResponse.json()).toEqual({ name: 'clone', forkedFrom: 'vm-alpha' });
    expect(
      store.auditEvents.some((e) => (e.entry as { action?: string }).action === 'vm.fork')
    ).toBe(true);

    const exportResponse = await machineExportRoute.POST({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest('http://local/api/smolvm/machines/vm-alpha/export', { repo: 'mine' })
    } as Parameters<typeof machineExportRoute.POST>[0]);
    expect(exportResponse.status).toBe(200);
    expect(await exportResponse.json()).toEqual({
      digest: 'sha256:abc',
      sizeBytes: 1234,
      platform: 'linux/amd64',
      manifest: null
    });
    expect(
      store.auditEvents.some((e) => (e.entry as { action?: string }).action === 'vm.export')
    ).toBe(true);

    const runResponse = await machineRunRoute.POST({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest('http://local/api/smolvm/machines/vm-alpha/run', {
        image: 'alpine',
        command: ['echo', 'hi']
      })
    } as Parameters<typeof machineRunRoute.POST>[0]);
    expect(runResponse.status).toBe(200);
    expect(await runResponse.json()).toEqual({
      exitCode: 0,
      stdout: 'vm-alpha:echo hi',
      stderr: ''
    });

    const filesPutMissingPath = await machineFilesRoute.PUT({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest(
        'http://local/api/smolvm/machines/vm-alpha/files',
        { content: 'x' },
        'PUT'
      ),
      url: new URL('http://local/api/smolvm/machines/vm-alpha/files')
    } as Parameters<typeof machineFilesRoute.PUT>[0]);
    expect(filesPutMissingPath.status).toBe(400);
    expect(await filesPutMissingPath.json()).toMatchObject({ code: 'SMOLVM_FILE_PATH_REQUIRED' });

    const filesPutMissingContent = await machineFilesRoute.PUT({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest(
        'http://local/api/smolvm/machines/vm-alpha/files?path=%2Fetc%2Fhosts',
        {},
        'PUT'
      ),
      url: new URL('http://local/api/smolvm/machines/vm-alpha/files?path=%2Fetc%2Fhosts')
    } as Parameters<typeof machineFilesRoute.PUT>[0]);
    expect(filesPutMissingContent.status).toBe(400);
    expect(await filesPutMissingContent.json()).toMatchObject({
      code: 'SMOLVM_FILE_CONTENT_REQUIRED'
    });

    const filesPutResponse = await machineFilesRoute.PUT({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest(
        'http://local/api/smolvm/machines/vm-alpha/files?path=%2Fetc%2Fhosts',
        { content: 'hello' },
        'PUT'
      ),
      url: new URL('http://local/api/smolvm/machines/vm-alpha/files?path=%2Fetc%2Fhosts')
    } as Parameters<typeof machineFilesRoute.PUT>[0]);
    expect(filesPutResponse.status).toBe(200);
    expect(await filesPutResponse.json()).toEqual({
      name: 'vm-alpha',
      path: '/etc/hosts',
      uploaded: 5
    });

    const volumesBadSize = await volumesRoute.POST({
      locals: adminLocals(),
      request: jsonRequest('http://local/api/smolvm/volumes', { sizeGb: 0 })
    } as Parameters<typeof volumesRoute.POST>[0]);
    expect(volumesBadSize.status).toBe(400);
    expect(await volumesBadSize.json()).toMatchObject({ code: 'SMOLVM_VOLUME_SIZE_INVALID' });

    const volumesResponse = await volumesRoute.POST({
      locals: adminLocals(),
      request: jsonRequest('http://local/api/smolvm/volumes', { sizeGb: 10, backend: 'lvm' })
    } as Parameters<typeof volumesRoute.POST>[0]);
    expect(volumesResponse.status).toBe(200);
    expect(await volumesResponse.json()).toEqual({
      id: 'vol-1',
      nodePath: '/var/smolvm/vol-1',
      sizeGb: 10,
      backend: 'lvm'
    });

    const volumeDeleteResponse = await volumeRoute.DELETE({
      locals: adminLocals(),
      params: { id: 'vol-1' }
    } as Parameters<typeof volumeRoute.DELETE>[0]);
    expect(volumeDeleteResponse.status).toBe(200);
    expect(await volumeDeleteResponse.json()).toEqual({ id: 'vol-1', deleted: true });
  });

  test('machine delete forwards force/cascade query params and start forwards forkable/registryAuth', async () => {
    const client = {
      deleteMachine: async (
        name: string,
        opts?: { force?: boolean; cascade?: boolean }
      ): Promise<Record<string, unknown>> => ({
        name,
        force: opts?.force === true,
        cascade: opts?.cascade === true
      }),
      startMachine: async (
        name: string,
        opts?: { forkable?: boolean; registryAuth?: { username: string; password: string } }
      ): Promise<Record<string, unknown>> => ({
        name,
        forkable: opts?.forkable === true,
        registryAuth: opts?.registryAuth
      })
    };
    installSmolVmClientMock(client);
    installManagerStoreMock();

    const deleteForced = await machineRoute.DELETE({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest(
        'http://local/api/smolvm/machines/vm-alpha?force=true&cascade=true',
        undefined,
        'DELETE'
      )
    } as Parameters<typeof machineRoute.DELETE>[0]);
    expect(deleteForced.status).toBe(200);
    expect(await deleteForced.json()).toEqual({
      name: 'vm-alpha',
      force: true,
      cascade: true
    });

    const deletePlain = await machineRoute.DELETE({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest('http://local/api/smolvm/machines/vm-alpha', undefined, 'DELETE')
    } as Parameters<typeof machineRoute.DELETE>[0]);
    expect(await deletePlain.json()).toEqual({ name: 'vm-alpha', force: false, cascade: false });

    const startWithOpts = await machineStartRoute.POST({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest('http://local/api/smolvm/machines/vm-alpha/start', {
        forkable: true,
        registryAuth: { username: 'u', password: 'p' }
      })
    } as Parameters<typeof machineStartRoute.POST>[0]);
    expect(startWithOpts.status).toBe(200);
    expect(await startWithOpts.json()).toEqual({
      name: 'vm-alpha',
      forkable: true,
      registryAuth: { username: 'u', password: 'p' }
    });

    const startPlain = await machineStartRoute.POST({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: jsonRequest('http://local/api/smolvm/machines/vm-alpha/start', undefined)
    } as Parameters<typeof machineStartRoute.POST>[0]);
    expect(await startPlain.json()).toEqual({
      name: 'vm-alpha',
      forkable: false,
      registryAuth: undefined
    });
  });

  test('system and metrics routes keep auth gates, fallback shapes, and history limits', async () => {
    installSmolVmClientMock();
    const store = installManagerStoreMock();

    expect(
      await healthRoute.GET({ locals: anonLocals() } as Parameters<typeof healthRoute.GET>[0])
    ).toMatchObject({ status: 401 });

    const healthResponse = await healthRoute.GET({
      locals: adminLocals()
    } as Parameters<typeof healthRoute.GET>[0]);
    expect(healthResponse.status).toBe(200);
    expect(await healthResponse.json()).toEqual({ status: 'ok', version: '0.8.1' });

    expect(
      await capacityRoute.GET({ locals: anonLocals() } as Parameters<typeof capacityRoute.GET>[0])
    ).toMatchObject({ status: 401 });

    const capacityResponse = await capacityRoute.GET({
      locals: adminLocals()
    } as Parameters<typeof capacityRoute.GET>[0]);
    expect(capacityResponse.status).toBe(200);
    expect(await capacityResponse.json()).toEqual({
      allocatedCpus: 4,
      allocatedMemoryMb: 8192,
      usedCpus: 2.5,
      usedMemoryMb: 4096,
      usedDiskGb: 50
    });

    const metricsResponse = await metricsRoute.GET({
      locals: adminLocals()
    } as Parameters<typeof metricsRoute.GET>[0]);
    expect(metricsResponse.status).toBe(200);
    expect(await metricsResponse.json()).toMatchObject({
      capacity: {
        allocatedCpus: 4,
        allocatedMemoryMb: 8192,
        usedCpus: 2.5,
        usedMemoryMb: 4096,
        usedDiskGb: 50
      },
      summary: {
        machinesRunning: 2,
        machinesTotal: 5,
        perVmUnavailable: true
      }
    });

    const historyResponse = await metricsHistoryRoute.GET({
      locals: adminLocals(),
      url: new URL('http://local/api/smolvm/metrics/history?machine=vm-alpha&limit=9999')
    } as Parameters<typeof metricsHistoryRoute.GET>[0]);
    expect(historyResponse.status).toBe(200);
    expect(await historyResponse.json()).toEqual({
      samples: [{ machineName: 'vm-alpha', cpu: 1, memoryMb: 2, diskGb: 3 }]
    });
    expect(store.metricsCalls).toEqual([{ machineName: 'vm-alpha', limit: 2880 }]);

    const managerUpdateResponse = await getManagerUpdate({
      locals: adminLocals()
    } as Parameters<typeof getManagerUpdate>[0]);
    expect(managerUpdateResponse.status).toBe(200);
    expect(await managerUpdateResponse.json()).toEqual({
      available: false,
      feature: 'managerUpdate',
      code: 'SMOLVM_MANAGER_UPDATE_UNAVAILABLE',
      message:
        'SmolVM 0.8.1 does not expose a server update endpoint. Upgrade the manager and SmolVM through the deployment process.'
    });

    const updateCommands: string[][] = [];
    const machineUpdateClient = createMachineUpdateClient(async () => ({
      name: 'vm-alpha',
      state: 'stopped',
      ports: [{ host: 8080, guest: 80 }]
    }));
    const machineUpdateResponse = await patchMachineUpdate(
      {
        locals: adminLocals(),
        params: { name: 'vm-alpha' },
        request: jsonRequest('http://local/api/smolvm/machines/vm-alpha/update', {
          name: 'vm-alpha',
          ports: [
            { host: 8080, guest: 80 },
            { host: 9090, guest: 90 }
          ]
        })
      } as Parameters<typeof patchMachineUpdate>[0],
      {
        client: machineUpdateClient,
        runner: async (command) => {
          updateCommands.push([...command]);
        }
      }
    );
    expect(machineUpdateResponse.status).toBe(200);
    expect(updateCommands).toEqual([
      ['smolvm', 'machine', 'update', '--name', 'vm-alpha', '--port', '9090:90']
    ]);

    expect(
      await patchMachineUpdate({
        locals: anonLocals(),
        params: { name: 'vm-alpha' }
      } as Parameters<typeof patchMachineUpdate>[0])
    ).toMatchObject({ status: 401 });
  });

  test('streaming routes preserve SSE content type and websocket upgrade metadata', async () => {
    const store = installManagerStoreMock();
    installSmolVmClientMock();

    const logsResponse = await machineLogsRoute.GET({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: new Request('http://local/api/smolvm/machines/vm-alpha/logs'),
      url: new URL('http://local/api/smolvm/machines/vm-alpha/logs?tail=2')
    } as Parameters<typeof machineLogsRoute.GET>[0]);

    expect(logsResponse.status).toBe(200);
    expect(logsResponse.headers.get('content-type')).toContain('text/event-stream');
    const logsText = await responseText(logsResponse);
    expect(logsText).toContain('event: ready');
    expect(logsText).toContain('"line":"first"');
    expect(logsText).toContain('"line":"third"');

    const terminalResponse = await machineTerminalRoute.GET({
      locals: adminLocals(),
      params: { name: 'vm-alpha' },
      request: new Request('http://local/api/smolvm/machines/vm-alpha/terminal'),
      url: new URL('http://local/api/smolvm/machines/vm-alpha/terminal')
    } as Parameters<typeof machineTerminalRoute.GET>[0]);

    expect(terminalResponse.status).toBe(426);
    expect(terminalResponse.headers.get('upgrade')).toBe('websocket');
    expect(terminalResponse.headers.get('cache-control')).toBe('no-store');
    expect(await terminalResponse.json()).toEqual({
      error: 'WebSocket upgrade required',
      code: 'WEBSOCKET_UPGRADE_REQUIRED',
      message: 'Use the authenticated WebSocket endpoint at /terminal/ws for interactive PTY I/O.'
    });
    expect(store.auditEvents).toHaveLength(1);
    expect(store.auditEvents[0].entry).toMatchObject({
      eventType: 'terminal.session',
      action: 'terminal.error'
    });
  });

  test('Docker Hub proxy routes use external HTTP clients and preserve JSON shapes', async () => {
    installDockerHubMock();

    expect(
      await dockerSearchRoute.GET({
        locals: anonLocals(),
        url: new URL('http://local/api/smolvm/docker-hub/search?q=alpine')
      } as Parameters<typeof dockerSearchRoute.GET>[0])
    ).toMatchObject({ status: 401 });

    const searchResponse = await dockerSearchRoute.GET({
      locals: adminLocals(),
      url: new URL('http://local/api/smolvm/docker-hub/search?q=alpine&page=2&page_size=10')
    } as Parameters<typeof dockerSearchRoute.GET>[0]);
    expect(searchResponse.status).toBe(200);
    expect(await searchResponse.json()).toEqual({
      results: [{ name: 'alpine', namespace: 'library', description: 'mocked' }],
      page: 2,
      pageSize: 10,
      totalCount: 1,
      nextPage: undefined,
      authenticated: false
    });

    const tagsResponse = await dockerTagsRoute.GET({
      locals: adminLocals(),
      url: new URL('http://local/api/smolvm/docker-hub/tags?image=library/alpine:latest')
    } as Parameters<typeof dockerTagsRoute.GET>[0]);
    expect(tagsResponse.status).toBe(200);
    expect(await tagsResponse.json()).toEqual({
      results: [
        {
          name: 'latest',
          digest: 'sha256:tag',
          images: [{ architecture: 'amd64', os: 'linux', digest: 'sha256:tag', size: 1 }]
        }
      ],
      page: 1,
      pageSize: 25,
      totalCount: 1,
      nextPage: undefined,
      authenticated: false
    });
  });

  test('TOML utility routes stay pure and keep validation responses', async () => {
    expect(
      await tomlValidateRoute.POST({
        locals: anonLocals(),
        request: jsonRequest('http://local/api/smolvm/toml-validate', {
          toml: 'name = "vm-alpha"\n'
        })
      } as Parameters<typeof tomlValidateRoute.POST>[0])
    ).toMatchObject({ status: 401 });

    const validateResponse = await tomlValidateRoute.POST({
      locals: adminLocals(),
      request: jsonRequest('http://local/api/smolvm/toml-validate', { toml: 'name = "vm-alpha"\n' })
    } as Parameters<typeof tomlValidateRoute.POST>[0]);
    expect(validateResponse.status).toBe(200);
    expect(await validateResponse.json()).toEqual({
      config: { name: 'vm-alpha' },
      validation: { valid: true }
    });

    const generateResponse = await tomlGenerateRoute.POST({
      locals: adminLocals(),
      request: jsonRequest('http://local/api/smolvm/toml-generate', validVmConfig)
    } as Parameters<typeof tomlGenerateRoute.POST>[0]);
    expect(generateResponse.status).toBe(200);
    expect(await generateResponse.json()).toEqual({
      toml: '[image]\nname = "alpine"\n\n[resources]\ncpus = 1\nmemory = 64\n'
    });
  });

  test('manager update route is authenticated and documents deployment upgrade fallback', async () => {
    const response = await getManagerUpdate({ locals: adminLocals() } as Parameters<
      typeof getManagerUpdate
    >[0]);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: false,
      feature: 'managerUpdate',
      code: 'SMOLVM_MANAGER_UPDATE_UNAVAILABLE',
      message:
        'SmolVM 0.8.1 does not expose a server update endpoint. Upgrade the manager and SmolVM through the deployment process.'
    });
  });

  test('machine update route applies port changes through smolvm machine update', async () => {
    const commands: string[][] = [];
    const client = createMachineUpdateClient(async () => ({
      name: 'vm one',
      state: 'stopped',
      ports: [{ host: 8080, guest: 80 }],
      cpus: 1,
      memoryMb: 64
    }));

    const response = await patchMachineUpdate(
      {
        locals: adminLocals(),
        params: { name: 'vm one' },
        request: jsonRequest('http://local/api/smolvm/machines/vm%20one/update', {
          name: 'vm one',
          cpus: 2,
          memory: 128,
          ports: [
            { host: 8080, guest: 80 },
            { host: 3000, guest: 3000 }
          ]
        })
      } as Parameters<typeof patchMachineUpdate>[0],
      {
        client,
        runner: async (command) => {
          commands.push([...command]);
        }
      }
    );

    expect(response.status).toBe(200);
    expect(commands).toEqual([
      [
        'smolvm',
        'machine',
        'update',
        '--name',
        'vm one',
        '--cpus',
        '2',
        '--mem',
        '128',
        '--port',
        '3000:3000'
      ]
    ]);
  });

  test('machine update route ignores submitted image fields when SmolVM omits them during live port update', async () => {
    const operations: string[] = [];
    const commands: string[][] = [];
    const client = createMachineUpdateClient(async () => ({
      name: 'running-vm',
      state: 'running',
      ports: [{ host: 8080, guest: 80 }],
      cpus: 2,
      memoryMb: 512
    }));
    client.stopMachine = async () => {
      operations.push('stop');
      return {};
    };
    client.startMachine = async () => {
      operations.push('start');
      return {};
    };

    const response = await patchMachineUpdate(
      {
        locals: adminLocals(),
        params: { name: 'running-vm' },
        request: jsonRequest('http://local/api/smolvm/machines/running-vm/update', {
          name: 'running-vm',
          image: 'docker.io/osminogin/tor-simple',
          tag: 'latest',
          sshAgent: false,
          cpus: 2,
          memory: 512,
          ports: [
            { host: 8080, guest: 80 },
            { host: 9090, guest: 90 }
          ]
        })
      } as Parameters<typeof patchMachineUpdate>[0],
      {
        client,
        runner: async (command) => {
          operations.push('update');
          commands.push([...command]);
        }
      }
    );

    expect(response.status).toBe(200);
    expect(operations).toEqual(['stop', 'update', 'start']);
    expect(commands).toEqual([
      [
        'smolvm',
        'machine',
        'update',
        '--name',
        'running-vm',
        '--cpus',
        '2',
        '--mem',
        '512',
        '--port',
        '9090:90'
      ]
    ]);
    expect(await response.json()).toMatchObject({ restartPerformed: true });
  });

  test('machine update route restarts a running machine around the update', async () => {
    const operations: string[] = [];
    const client = createMachineUpdateClient(async () => ({
      name: 'running-vm',
      state: 'running',
      ports: [{ host: 8080, guest: 80 }]
    }));
    client.stopMachine = async () => {
      operations.push('stop');
      return {};
    };
    client.startMachine = async () => {
      operations.push('start');
      return {};
    };

    const response = await patchMachineUpdate(
      {
        locals: adminLocals(),
        params: { name: 'running-vm' },
        request: jsonRequest('http://local/api/smolvm/machines/running-vm/update', {
          name: 'running-vm',
          ports: [
            { host: 8080, guest: 80 },
            { host: 9090, guest: 90 }
          ]
        })
      } as Parameters<typeof patchMachineUpdate>[0],
      {
        client,
        runner: async () => {
          operations.push('update');
        }
      }
    );

    expect(response.status).toBe(200);
    expect(operations).toEqual(['stop', 'update', 'start']);
    expect(await response.json()).toMatchObject({ restartPerformed: true });
  });

  test('machine update route reports a stopped machine when update fails after stop', async () => {
    const operations: string[] = [];
    const client = createMachineUpdateClient(async () => ({
      name: 'running-vm',
      state: 'running',
      env: { MODE: 'old' }
    }));
    client.stopMachine = async () => {
      operations.push('stop');
      return {};
    };

    const response = await patchMachineUpdate(
      {
        locals: adminLocals(),
        params: { name: 'running-vm' },
        request: jsonRequest('http://local/api/smolvm/machines/running-vm/update', {
          name: 'running-vm',
          env: { MODE: 'new' }
        })
      } as Parameters<typeof patchMachineUpdate>[0],
      {
        client,
        runner: async () => {
          operations.push('update');
          throw new SmolVmError(SMOLVM_ERROR_CODES.REQUEST_FAILED, 'update failed', 502);
        }
      }
    );

    expect(response.status).toBe(502);
    expect(operations).toEqual(['stop', 'update']);
    expect(await response.json()).toMatchObject({
      stage: 'update',
      machineState: 'stopped',
      restartPerformed: false
    });
  });

  test('machine update route reports saved config when restart fails', async () => {
    const operations: string[] = [];
    const client = createMachineUpdateClient(async () => ({
      name: 'running-vm',
      state: 'running',
      ports: []
    }));
    client.stopMachine = async () => {
      operations.push('stop');
      return {};
    };
    client.startMachine = async () => {
      operations.push('start');
      throw new SmolVmError(SMOLVM_ERROR_CODES.REQUEST_FAILED, 'start failed', 502);
    };

    const response = await patchMachineUpdate(
      {
        locals: adminLocals(),
        params: { name: 'running-vm' },
        request: jsonRequest('http://local/api/smolvm/machines/running-vm/update', {
          name: 'running-vm',
          ports: [{ host: 9090, guest: 90 }]
        })
      } as Parameters<typeof patchMachineUpdate>[0],
      {
        client,
        runner: async () => {
          operations.push('update');
        }
      }
    );

    expect(response.status).toBe(502);
    expect(operations).toEqual(['stop', 'update', 'start']);
    expect(await response.json()).toMatchObject({
      stage: 'restart',
      configUpdated: true,
      machineState: 'stopped',
      restartPerformed: false
    });
  });

  test('machine update route enforces recreate-required path with 409', async () => {
    const client = createMachineUpdateClient(async () => ({
      name: 'vm one',
      state: 'stopped',
      image: 'alpine:latest'
    }));
    const response = await patchMachineUpdate(
      {
        locals: adminLocals(),
        params: { name: 'vm one' },
        request: jsonRequest('http://local/api/smolvm/machines/vm%20one/update', {
          name: 'vm one',
          image: 'ubuntu'
        })
      } as Parameters<typeof patchMachineUpdate>[0],
      { client }
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      available: false,
      feature: 'machineUpdate',
      code: 'SMOLVM_RECREATE_REQUIRED',
      machine: 'vm one',
      message: 'These configuration fields require VM recreation through the recreate endpoint.',
      fields: ['image', 'tag'],
      recreateEndpoint: '/api/smolvm/machines/vm%20one/recreate'
    });
  });

  test('machine update route rejects unauthenticated requests before fallback details', async () => {
    const response = await patchMachineUpdate({
      locals: anonLocals(),
      params: { name: 'vm one' }
    } as Parameters<typeof patchMachineUpdate>[0]);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });
});
