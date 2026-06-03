import { expect, test, beforeEach, describe } from 'bun:test';
import manifest from '../../../app.ts';
import {
  createMockManagerStoreClient,
  createManagerStoreClient,
  getManagerStoreClient,
  getManagerStoreMode,
  resetMockManagerStore,
  getMockSavedVmConfigs,
  getMockMetricsSamples,
  getMockAuditEvents,
  getMockUiPreferences,
  getMockSettings,
  ManagerStoreError,
  STORE_ERROR_CODES
} from './manager-store-client';

beforeEach(() => {
  resetMockManagerStore();
});

type FetchCall = {
  url: URL;
  method: string;
  body: string | undefined;
  init: RequestInit | undefined;
};

type FetchRoute = {
  method: string;
  match: (url: URL, body: string | undefined) => boolean;
  response: Response | ((call: FetchCall) => Response | Promise<Response>);
};

type FetchStub = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function createSequentialFetchStub(routes: FetchRoute[]) {
  const calls: FetchCall[] = [];
  let index = 0;

  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
    );
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;
    const call = { url, method, body, init };
    calls.push(call);

    const route = routes[index++];
    if (!route) {
      throw new Error(`Unexpected fetch: ${method} ${url.pathname}${url.search}`);
    }

    expect(route.method).toBe(method);
    expect(route.match(url, body)).toBe(true);

    return typeof route.response === 'function' ? await route.response(call) : route.response;
  };

  return { fetchStub, calls };
}

async function withPatchedFetch<T>(fetchStub: FetchStub, fn: () => Promise<T>): Promise<T> {
  const originalFetch = globalThis.fetch;
  const originalPylonUrl = process.env.PYLON_URL;
  process.env.PYLON_URL = 'http://pylon.test';
  globalThis.fetch = fetchStub as typeof fetch;

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    if (originalPylonUrl === undefined) {
      delete process.env.PYLON_URL;
    } else {
      process.env.PYLON_URL = originalPylonUrl;
    }
  }
}

async function withStoreMode<T>(
  mode: 'typed' | 'rest' | 'mock' | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const originalMode = process.env.PYLON_STORE_MODE;
  const originalMock = process.env.PYLON_STORE_MOCK;

  if (mode === undefined) {
    delete process.env.PYLON_STORE_MODE;
    delete process.env.PYLON_STORE_MOCK;
  } else {
    process.env.PYLON_STORE_MODE = mode;
    delete process.env.PYLON_STORE_MOCK;
  }

  try {
    return await fn();
  } finally {
    if (originalMode === undefined) {
      delete process.env.PYLON_STORE_MODE;
    } else {
      process.env.PYLON_STORE_MODE = originalMode;
    }
    if (originalMock === undefined) {
      delete process.env.PYLON_STORE_MOCK;
    } else {
      process.env.PYLON_STORE_MOCK = originalMock;
    }
  }
}

async function withFixedDate<T>(iso: string, fn: () => Promise<T>): Promise<T> {
  const RealDate = Date;

  class FixedDate extends RealDate {
    constructor(value?: string | number | Date) {
      if (arguments.length === 0) {
        super(iso);
        return;
      }

      super(value!);
    }

    static now(): number {
      return RealDate.parse(iso);
    }

    static parse = RealDate.parse;
    static UTC = RealDate.UTC;
  }

  (globalThis as { Date: typeof Date }).Date = FixedDate as unknown as typeof Date;

  try {
    return await fn();
  } finally {
    (globalThis as { Date: typeof Date }).Date = RealDate;
  }
}

function expectIsoTimestamp(value: string): void {
  expect(new Date(value).toISOString()).toBe(value);
}

function parseJsonBody(body: string | undefined): Record<string, unknown> {
  expect(body).toBeDefined();
  return JSON.parse(body!);
}

function withoutId<T extends { id: string }>(value: T): Omit<T, 'id'> {
  const { id, ...rest } = value;
  void id;
  return rest;
}

// ---------------------------------------------------------------------------
// Manifest schema tests
// ---------------------------------------------------------------------------

describe('manifest', () => {
  test('includes all required entities', () => {
    const entityNames = manifest.entities.map((e) => e.name);
    expect(entityNames).toContain('User');
    expect(entityNames).toContain('AuditEvent');
    expect(entityNames).toContain('ManagerSetting');
    expect(entityNames).toContain('SavedVmConfig');
    expect(entityNames).toContain('TomlSnapshot');
    expect(entityNames).toContain('MetricsSample');
    expect(entityNames).toContain('UiPreference');
  });

  test('ManagerSetting has correct fields', () => {
    const entity = manifest.entities.find((e) => e.name === 'ManagerSetting');
    expect(entity).toBeDefined();
    const fieldNames = entity!.fields.map((f) => f.name);
    expect(fieldNames).toContain('key');
    expect(fieldNames).toContain('valueJson');
    expect(fieldNames).toContain('updatedAt');

    const keyField = entity!.fields.find((f) => f.name === 'key');
    expect(keyField!.type).toBe('string');
    expect(keyField!.unique).toBe(true);
  });

  test('SavedVmConfig has correct fields', () => {
    const entity = manifest.entities.find((e) => e.name === 'SavedVmConfig');
    expect(entity).toBeDefined();
    const fieldNames = entity!.fields.map((f) => f.name);
    expect(fieldNames).toContain('name');
    expect(fieldNames).toContain('machineName');
    expect(fieldNames).toContain('configJson');
    expect(fieldNames).toContain('toml');
    expect(fieldNames).toContain('createdAt');
    expect(fieldNames).toContain('updatedAt');
  });

  test('TomlSnapshot has correct fields', () => {
    const entity = manifest.entities.find((e) => e.name === 'TomlSnapshot');
    expect(entity).toBeDefined();
    const fieldNames = entity!.fields.map((f) => f.name);
    expect(fieldNames).toContain('machineName');
    expect(fieldNames).toContain('toml');
    expect(fieldNames).toContain('reason');
    expect(fieldNames).toContain('createdAt');

    const reasonField = entity!.fields.find((f) => f.name === 'reason');
    expect(reasonField!.optional).toBe(true);
  });

  test('MetricsSample has correct fields', () => {
    const entity = manifest.entities.find((e) => e.name === 'MetricsSample');
    expect(entity).toBeDefined();
    const fieldNames = entity!.fields.map((f) => f.name);
    expect(fieldNames).toContain('machineName');
    expect(fieldNames).toContain('cpu');
    expect(fieldNames).toContain('memoryMb');
    expect(fieldNames).toContain('diskGb');
    expect(fieldNames).toContain('networkRxBytes');
    expect(fieldNames).toContain('networkTxBytes');
    expect(fieldNames).toContain('sampledAt');

    const machineNameField = entity!.fields.find((f) => f.name === 'machineName');
    expect(machineNameField!.optional).toBe(true);

    const cpuField = entity!.fields.find((f) => f.name === 'cpu');
    expect(cpuField!.type).toBe('float');
  });

  test('UiPreference has correct fields', () => {
    const entity = manifest.entities.find((e) => e.name === 'UiPreference');
    expect(entity).toBeDefined();
    const fieldNames = entity!.fields.map((f) => f.name);
    expect(fieldNames).toContain('userId');
    expect(fieldNames).toContain('key');
    expect(fieldNames).toContain('valueJson');
    expect(fieldNames).toContain('updatedAt');
  });

  test('AuditEvent has extended fields', () => {
    const entity = manifest.entities.find((e) => e.name === 'AuditEvent');
    expect(entity).toBeDefined();
    const fieldNames = entity!.fields.map((f) => f.name);
    expect(fieldNames).toContain('eventType');
    expect(fieldNames).toContain('actorUserId');
    expect(fieldNames).toContain('action');
    expect(fieldNames).toContain('details');
    expect(fieldNames).toContain('ipAddress');
    expect(fieldNames).toContain('createdAt');
  });

  test('includes policies for all manager metadata entities', () => {
    const policyEntities = manifest.policies.map((p) => p.entity);
    expect(policyEntities).toContain('ManagerSetting');
    expect(policyEntities).toContain('SavedVmConfig');
    expect(policyEntities).toContain('TomlSnapshot');
    expect(policyEntities).toContain('MetricsSample');
    expect(policyEntities).toContain('AuditEvent');
    expect(policyEntities).toContain('UiPreference');
    expect(manifest.policies).toHaveLength(6);
  });

  test('admin-only entities require admin role for read and write', () => {
    const adminOnlyEntities = ['ManagerSetting', 'SavedVmConfig', 'TomlSnapshot', 'MetricsSample'];
    for (const entityName of adminOnlyEntities) {
      const p = manifest.policies.find((pol) => pol.entity === entityName);
      expect(p).toBeDefined();
      expect(p!.allowRead).toBe("auth.hasRole('admin')");
      expect(p!.allowWrite).toBe("auth.hasRole('admin')");
    }
  });

  test('AuditEvent policy restricts all operations to admin', () => {
    const p = manifest.policies.find((pol) => pol.entity === 'AuditEvent');
    expect(p).toBeDefined();
    expect(p!.allowRead).toBe("auth.hasRole('admin')");
    expect(p!.allowInsert).toBe("auth.hasRole('admin')");
    expect(p!.allowUpdate).toBe("auth.hasRole('admin')");
    expect(p!.allowDelete).toBe("auth.hasRole('admin')");
  });

  test('UiPreference policy scopes to owning user or admin', () => {
    const p = manifest.policies.find((pol) => pol.entity === 'UiPreference');
    expect(p).toBeDefined();
    expect(p!.allowRead).toBe("auth.userId == data.userId || auth.hasRole('admin')");
    expect(p!.allowWrite).toBe("auth.userId == data.userId || auth.hasRole('admin')");
  });

// ---------------------------------------------------------------------------
// Mock store: ManagerSetting
// ---------------------------------------------------------------------------

describe('mock ManagerSetting', () => {
  test('creates and reads a setting', async () => {
    const client = createMockManagerStoreClient();
    const setting = await client.setSetting('theme', '"dark"');

    expect(setting.key).toBe('theme');
    expect(setting.valueJson).toBe('"dark"');

    const found = await client.getSetting('theme');
    expect(found).not.toBeNull();
    expect(found!.valueJson).toBe('"dark"');
  });

  test('updates an existing setting', async () => {
    const client = createMockManagerStoreClient();
    await client.setSetting('theme', '"dark"');
    const updated = await client.setSetting('theme', '"light"');

    expect(updated.valueJson).toBe('"light"');
    expect(getMockSettings()).toHaveLength(1);
  });

  test('lists all settings', async () => {
    const client = createMockManagerStoreClient();
    await client.setSetting('theme', '"dark"');
    await client.setSetting('language', '"fr"');

    const list = await client.listSettings();
    expect(list).toHaveLength(2);
  });

// ---------------------------------------------------------------------------
// Mock store: SavedVmConfig
// ---------------------------------------------------------------------------

describe('mock SavedVmConfig', () => {
  test('creates and reads saved VM config', async () => {
    const client = createMockManagerStoreClient();
    const created = await client.createSavedVmConfig({
      name: 'web-server',
      machineName: 'vm-web-01',
      configJson: '{"cpu":2}',
      toml: '[machine]\ncpu = 2'
    });

    expect(created.name).toBe('web-server');
    expect(created.machineName).toBe('vm-web-01');

    const found = await client.getSavedVmConfig(created.id);
    expect(found).not.toBeNull();
    expect(found!.configJson).toBe('{"cpu":2}');
  });

  test('lists saved VM configs', async () => {
    const client = createMockManagerStoreClient();
    await client.createSavedVmConfig({
      name: 'a',
      machineName: 'vm-a',
      configJson: '{}',
      toml: ''
    });
    await client.createSavedVmConfig({
      name: 'b',
      machineName: 'vm-b',
      configJson: '{}',
      toml: ''
    });

    const list = await client.listSavedVmConfigs();
    expect(list).toHaveLength(2);
  });

  test('updates saved VM config', async () => {
    const client = createMockManagerStoreClient();
    const created = await client.createSavedVmConfig({
      name: 'old',
      machineName: 'vm-old',
      configJson: '{}',
      toml: ''
    });

    const updated = await client.updateSavedVmConfig(created.id, { name: 'new' });
    expect(updated.name).toBe('new');
    expect(updated.machineName).toBe('vm-old');
  });

  test('deletes saved VM config', async () => {
    const client = createMockManagerStoreClient();
    const created = await client.createSavedVmConfig({
      name: 'to-delete',
      machineName: 'vm-del',
      configJson: '{}',
      toml: ''
    });

    await client.deleteSavedVmConfig(created.id);
    expect(getMockSavedVmConfigs()).toHaveLength(0);
  });
});
});

// ---------------------------------------------------------------------------
// Mock store: TomlSnapshot
// ---------------------------------------------------------------------------

describe('mock TomlSnapshot', () => {
  test('appends and lists snapshots', async () => {
    const client = createMockManagerStoreClient();
    await client.createTomlSnapshot({
      machineName: 'vm-1',
      toml: '[machine]\ncpu = 1',
      reason: 'initial'
    });
    await client.createTomlSnapshot({
      machineName: 'vm-1',
      toml: '[machine]\ncpu = 2',
      reason: 'upgrade'
    });
    await client.createTomlSnapshot({
      machineName: 'vm-2',
      toml: '[machine]\ncpu = 4',
      reason: 'new'
    });

    const all = await client.listTomlSnapshots();
    expect(all).toHaveLength(3);

    const forVm1 = await client.listTomlSnapshots('vm-1');
    expect(forVm1).toHaveLength(2);
    expect(forVm1[0].reason).toBe('initial');
    expect(forVm1[1].reason).toBe('upgrade');

    const forVm2 = await client.listTomlSnapshots('vm-2');
    expect(forVm2).toHaveLength(1);
  });

  test('snapshot without reason stores null', async () => {
    const client = createMockManagerStoreClient();
    const snap = await client.createTomlSnapshot({
      machineName: 'vm-1',
      toml: '[machine]\ncpu = 1'
    });

    expect(snap.reason).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mock store: MetricsSample
// ---------------------------------------------------------------------------

describe('mock MetricsSample', () => {
  test('inserts and lists metrics', async () => {
    const client = createMockManagerStoreClient();
    await client.insertMetricsSample({
      machineName: 'vm-1',
      cpu: 12.5,
      memoryMb: 1024,
      diskGb: 50,
      networkRxBytes: 1000,
      networkTxBytes: 2000
    });

    const list = await client.listMetricsSamples();
    expect(list).toHaveLength(1);
    expect(list[0].cpu).toBe(12.5);
    expect(list[0].machineName).toBe('vm-1');
  });

  test('inserts metrics without machineName', async () => {
    const client = createMockManagerStoreClient();
    await client.insertMetricsSample({
      cpu: 5,
      memoryMb: 512,
      diskGb: 20,
      networkRxBytes: 100,
      networkTxBytes: 200
    });

    const list = await client.listMetricsSamples();
    expect(list[0].machineName).toBeNull();
  });

  test('prunes metrics by beforeDate', async () => {
    const client = createMockManagerStoreClient();
    // We can't easily manipulate dates in the mock, so we'll insert and then prune with a future date
    await client.insertMetricsSample({
      machineName: 'vm-1',
      cpu: 1,
      memoryMb: 100,
      diskGb: 10,
      networkRxBytes: 1,
      networkTxBytes: 1
    });
    await client.insertMetricsSample({
      machineName: 'vm-1',
      cpu: 2,
      memoryMb: 200,
      diskGb: 20,
      networkRxBytes: 2,
      networkTxBytes: 2
    });

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const pruned = await client.pruneMetricsSamples(future);
    expect(pruned).toBe(2);
    expect(getMockMetricsSamples()).toHaveLength(0);
  });

  test('prunes metrics by maxCount', async () => {
    const client = createMockManagerStoreClient();
    for (let i = 0; i < 5; i++) {
      await client.insertMetricsSample({
        machineName: 'vm-1',
        cpu: i,
        memoryMb: 100,
        diskGb: 10,
        networkRxBytes: 1,
        networkTxBytes: 1
      });
    }

    const pruned = await client.pruneMetricsSamples(undefined, 2);
    expect(pruned).toBe(3);
    expect(getMockMetricsSamples()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Mock store: AuditEvent
// ---------------------------------------------------------------------------

describe('mock AuditEvent', () => {
  test('inserts audit events without affecting runtime truth', async () => {
    const client = createMockManagerStoreClient();
    await client.insertAuditEvent({
      eventType: 'login',
      actorUserId: 'user-1',
      action: 'sign_in',
      details: 'Admin login',
      ipAddress: '127.0.0.1'
    });
    await client.insertAuditEvent({
      eventType: 'vm_start',
      action: 'start',
      details: 'Started vm-1'
    });

    const events = getMockAuditEvents();
    expect(events).toHaveLength(2);
    expect(events[0].eventType).toBe('login');
    expect(events[0].actorUserId).toBe('user-1');
    expect(events[1].ipAddress).toBeNull();
  });

  test('lists audit events with limit', async () => {
    const client = createMockManagerStoreClient();
    for (let i = 0; i < 5; i++) {
      await client.insertAuditEvent({ eventType: `event-${i}` });
    }

    const list = await client.listAuditEvents(3);
    expect(list).toHaveLength(3);
  });

  test('prunes audit events by maxCount', async () => {
    const client = createMockManagerStoreClient();
    for (let i = 0; i < 5; i++) {
      await client.insertAuditEvent({ eventType: `event-${i}` });
    }

    const pruned = await client.pruneAuditEvents(undefined, 2);
    expect(pruned).toBe(3);
    expect(getMockAuditEvents()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Mock store: UiPreference
// ---------------------------------------------------------------------------

describe('mock UiPreference', () => {
  test('creates and reads UI preference', async () => {
    const client = createMockManagerStoreClient();
    const pref = await client.setUiPreference('user-1', 'sidebarCollapsed', 'true');

    expect(pref.userId).toBe('user-1');
    expect(pref.key).toBe('sidebarCollapsed');
    expect(pref.valueJson).toBe('true');

    const found = await client.getUiPreference('user-1', 'sidebarCollapsed');
    expect(found).not.toBeNull();
    expect(found!.valueJson).toBe('true');
  });

  test('updates existing UI preference', async () => {
    const client = createMockManagerStoreClient();
    await client.setUiPreference('user-1', 'theme', '"dark"');
    const updated = await client.setUiPreference('user-1', 'theme', '"light"');

    expect(updated.valueJson).toBe('"light"');
    expect(getMockUiPreferences()).toHaveLength(1);
  });

  test('lists UI preferences per user', async () => {
    const client = createMockManagerStoreClient();
    await client.setUiPreference('user-1', 'theme', '"dark"');
    await client.setUiPreference('user-1', 'lang', '"fr"');
    await client.setUiPreference('user-2', 'theme', '"light"');

    const list = await client.listUiPreferences('user-1');
    expect(list).toHaveLength(2);
  });
});

describe('error codes', () => {
  test('exposes validation error code on ManagerStoreError', () => {
    const error = new ManagerStoreError(STORE_ERROR_CODES.VALIDATION, 'Invalid input.', 400, {
      field: 'key'
    });

    expect(error.code).toBe(STORE_ERROR_CODES.VALIDATION);
    expect(error.status).toBe(400);
    expect(error.message).toBe('Invalid input.');
    expect(error.details).toEqual({ field: 'key' });
  });

  test('mock updateSavedVmConfig missing throws not-found', async () => {
    const client = createMockManagerStoreClient();

    try {
      await client.updateSavedVmConfig('missing', { name: 'new' });
      throw new Error('Expected updateSavedVmConfig to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ManagerStoreError);
      const storeError = error as ManagerStoreError;
      expect(storeError.code).toBe(STORE_ERROR_CODES.NOT_FOUND);
      expect(storeError.status).toBe(404);
    }
  });
});

describe('store mode selection', () => {
  test('defaults to typed mode when no store env is set', async () => {
    await withStoreMode(undefined, async () => {
      expect(getManagerStoreMode()).toBe('typed');
    });
  });

  test('honors explicit typed, rest, and mock modes', async () => {
    await withStoreMode('typed', async () => {
      expect(getManagerStoreMode()).toBe('typed');
    });
    await withStoreMode('rest', async () => {
      expect(getManagerStoreMode()).toBe('rest');
    });
    await withStoreMode('mock', async () => {
      expect(getManagerStoreMode()).toBe('mock');
    });
  });

  test('preserves PYLON_STORE_MOCK as a legacy mock alias', async () => {
    const originalMode = process.env.PYLON_STORE_MODE;
    const originalMock = process.env.PYLON_STORE_MOCK;
    delete process.env.PYLON_STORE_MODE;
    process.env.PYLON_STORE_MOCK = 'true';

    try {
      expect(getManagerStoreMode()).toBe('mock');
    } finally {
      if (originalMode === undefined) {
        delete process.env.PYLON_STORE_MODE;
      } else {
        process.env.PYLON_STORE_MODE = originalMode;
      }
      if (originalMock === undefined) {
        delete process.env.PYLON_STORE_MOCK;
      } else {
        process.env.PYLON_STORE_MOCK = originalMock;
      }
    }
  });

  test('getManagerStoreClient returns the mock implementation in mock mode', async () => {
    await withStoreMode('mock', async () => {
      resetMockManagerStore();
      const client = getManagerStoreClient();
      await client.setSetting('theme', '"dark"');

      expect(getMockSettings()).toHaveLength(1);
    });
  });

  test('getManagerStoreClient uses REST fallback in rest mode', async () => {
    const { fetchStub } = createSequentialFetchStub([
      {
        method: 'GET',
        match: (url) => url.pathname === '/api/entities/ManagerSetting',
        response: jsonResponse({ data: [] })
      }
    ]);

    await withStoreMode('rest', async () => {
      await withPatchedFetch(fetchStub, async () => {
        const client = getManagerStoreClient();
        await expect(client.listSettings()).resolves.toEqual([]);
      });
    });
  });

  test('typed mode uses the Pylon sync transport against generated entity endpoints', async () => {
    const { fetchStub, calls } = createSequentialFetchStub([
      {
        method: 'GET',
        match: (url) => url.pathname === '/api/entities/ManagerSetting',
        response: jsonResponse({ data: [] })
      }
    ]);

    await withStoreMode('typed', async () => {
      await withPatchedFetch(fetchStub, async () => {
        const client = getManagerStoreClient();
        await expect(client.listSettings()).resolves.toEqual([]);
      });
    });

    expect(calls[0].init?.credentials).toBe('include');
    expect(new Headers(calls[0].init?.headers).get('Accept')).toBe('application/json');
  });
});

describe('real client contract', () => {
  test('ManagerSetting methods preserve timestamps and request shapes', async () => {
    const iso = '2026-06-03T12:00:00.000Z';
    const postedBodies: string[] = [];
    const { fetchStub, calls } = createSequentialFetchStub([
      {
        method: 'GET',
        match: (url) =>
          url.pathname === '/api/entities/ManagerSetting' &&
          url.searchParams.get('filter') === 'key eq "theme"',
        response: jsonResponse({ data: [] })
      },
      {
        method: 'GET',
        match: (url) =>
          url.pathname === '/api/entities/ManagerSetting' &&
          url.searchParams.get('filter') === 'key eq "theme"',
        response: jsonResponse({ data: [] })
      },
      {
        method: 'POST',
        match: (url) => url.pathname === '/api/entities/ManagerSetting',
        response: ({ body }) => {
          postedBodies.push(body ?? '');
          return jsonResponse({ id: 'setting-1', key: 'theme', valueJson: '"dark"', updatedAt: iso });
        }
      },
      {
        method: 'GET',
        match: (url) => url.pathname === '/api/entities/ManagerSetting',
        response: jsonResponse({
          data: [{ id: 'setting-1', key: 'theme', valueJson: '"dark"', updatedAt: iso }]
        })
      }
    ]);

    await withFixedDate(iso, async () =>
      withPatchedFetch(fetchStub, async () => {
        const client = createManagerStoreClient();

        await expect(client.getSetting('theme')).resolves.toBeNull();

        const created = await client.setSetting('theme', '"dark"');
        expect(created.updatedAt).toBe(iso);
        expectIsoTimestamp(created.updatedAt);

        const list = await client.listSettings();
        expect(list).toEqual([created]);
      })
    );

    expect(calls).toHaveLength(4);
    expect(JSON.parse(postedBodies[0] ?? '{}')).toMatchObject({
      key: 'theme',
      valueJson: '"dark"',
      updatedAt: iso
    });
  });

  test('ManagerSetting request failures and unavailable errors are structured', async () => {
    const { fetchStub } = createSequentialFetchStub([
      {
        method: 'GET',
        match: (url) => url.pathname === '/api/entities/ManagerSetting',
        response: new Response('boom', { status: 500 })
      }
    ]);

    await withPatchedFetch(fetchStub, async () => {
      const client = createManagerStoreClient();

      await expect(client.listSettings()).rejects.toMatchObject({
        code: STORE_ERROR_CODES.REQUEST_FAILED,
        status: 500
      });
    });

    const throwingFetch: FetchStub = async () => {
      throw new TypeError('network down');
    };

    await withPatchedFetch(throwingFetch, async () => {
      const client = createManagerStoreClient();
      await expect(client.listSettings()).rejects.toMatchObject({
        code: STORE_ERROR_CODES.UNAVAILABLE,
        status: 503
      });
    });
  });

  test('SavedVmConfig methods preserve timestamps and not-found behavior', async () => {
    const iso = '2026-06-03T12:01:00.000Z';
    const { fetchStub, calls } = createSequentialFetchStub([
      {
        method: 'POST',
        match: (url, body) => {
          if (url.pathname !== '/api/entities/SavedVmConfig') return false;
          const payload = parseJsonBody(body);
          expect(payload).toMatchObject({
            name: 'web-server',
            machineName: 'vm-web-01',
            configJson: '{"cpu":2}',
            toml: '[machine]\ncpu = 2',
            createdAt: iso,
            updatedAt: iso
          });
          return true;
        },
        response: jsonResponse({
          id: 'cfg-1',
          name: 'web-server',
          machineName: 'vm-web-01',
          configJson: '{"cpu":2}',
          toml: '[machine]\ncpu = 2',
          createdAt: iso,
          updatedAt: iso
        })
      },
      {
        method: 'GET',
        match: (url) => url.pathname === '/api/entities/SavedVmConfig/cfg-1',
        response: jsonResponse({
          id: 'cfg-1',
          name: 'web-server',
          machineName: 'vm-web-01',
          configJson: '{"cpu":2}',
          toml: '[machine]\ncpu = 2',
          createdAt: iso,
          updatedAt: iso
        })
      },
      {
        method: 'GET',
        match: (url) => url.pathname === '/api/entities/SavedVmConfig',
        response: jsonResponse({
          data: [
            {
              id: 'cfg-1',
              name: 'web-server',
              machineName: 'vm-web-01',
              configJson: '{"cpu":2}',
              toml: '[machine]\ncpu = 2',
              createdAt: iso,
              updatedAt: iso
            }
          ]
        })
      },
      {
        method: 'PATCH',
        match: (url, body) => {
          if (url.pathname !== '/api/entities/SavedVmConfig/cfg-1') return false;
          const payload = parseJsonBody(body);
          expect(payload).toMatchObject({ name: 'web-server-2', updatedAt: iso });
          return true;
        },
        response: jsonResponse({
          id: 'cfg-1',
          name: 'web-server-2',
          machineName: 'vm-web-01',
          configJson: '{"cpu":2}',
          toml: '[machine]\ncpu = 2',
          createdAt: iso,
          updatedAt: iso
        })
      },
      {
        method: 'DELETE',
        match: (url) => url.pathname === '/api/entities/SavedVmConfig/cfg-1',
        response: new Response(null, { status: 204 })
      },
      {
        method: 'GET',
        match: (url) => url.pathname === '/api/entities/SavedVmConfig/missing',
        response: new Response('missing', { status: 404 })
      }
    ]);

    await withFixedDate(iso, async () =>
      withPatchedFetch(fetchStub, async () => {
        const client = createManagerStoreClient();

        const created = await client.createSavedVmConfig({
          name: 'web-server',
          machineName: 'vm-web-01',
          configJson: '{"cpu":2}',
          toml: '[machine]\ncpu = 2'
        });
        expect(created.createdAt).toBe(iso);
        expectIsoTimestamp(created.createdAt);

        const found = await client.getSavedVmConfig('cfg-1');
        expect(found).not.toBeNull();
        expect(found!.id).toBe('cfg-1');

        const list = await client.listSavedVmConfigs();
        expect(list).toEqual([created]);

        const updated = await client.updateSavedVmConfig('cfg-1', { name: 'web-server-2' });
        expect(updated.name).toBe('web-server-2');
        expect(updated.updatedAt).toBe(iso);

        await client.deleteSavedVmConfig('cfg-1');

        await expect(client.getSavedVmConfig('missing')).resolves.toBeNull();
      })
    );

    expect(calls).toHaveLength(6);
  });

  test('SavedVmConfig request failures are surfaced as request errors', async () => {
    const { fetchStub } = createSequentialFetchStub([
      {
        method: 'PATCH',
        match: (url) => url.pathname === '/api/entities/SavedVmConfig/cfg-1',
        response: new Response('nope', { status: 500 })
      }
    ]);

    await withPatchedFetch(fetchStub, async () => {
      const client = createManagerStoreClient();
      await expect(client.updateSavedVmConfig('cfg-1', { name: 'nope' })).rejects.toMatchObject({
        code: STORE_ERROR_CODES.REQUEST_FAILED,
        status: 500
      });
    });
  });

  test('TomlSnapshot methods preserve timestamp and machineName filtering', async () => {
    const iso = '2026-06-03T12:02:00.000Z';
    const { fetchStub, calls } = createSequentialFetchStub([
      {
        method: 'POST',
        match: (url, body) => {
          if (url.pathname !== '/api/entities/TomlSnapshot') return false;
          const payload = parseJsonBody(body);
          expect(payload).toMatchObject({ machineName: 'vm-1', toml: '[machine]\ncpu = 1', reason: 'initial', createdAt: iso });
          return true;
        },
        response: jsonResponse({ id: 'snap-1', machineName: 'vm-1', toml: '[machine]\ncpu = 1', reason: 'initial', createdAt: iso })
      },
      {
        method: 'GET',
        match: (url) =>
          url.pathname === '/api/entities/TomlSnapshot' &&
          url.searchParams.get('filter') === 'machineName eq "vm-1"',
        response: jsonResponse({
          data: [
            { id: 'snap-1', machineName: 'vm-1', toml: '[machine]\ncpu = 1', reason: 'initial', createdAt: iso }
          ]
        })
      }
    ]);

    await withFixedDate(iso, async () =>
      withPatchedFetch(fetchStub, async () => {
        const client = createManagerStoreClient();
        const created = await client.createTomlSnapshot({
          machineName: 'vm-1',
          toml: '[machine]\ncpu = 1',
          reason: 'initial'
        });
        expect(created.createdAt).toBe(iso);
        const list = await client.listTomlSnapshots('vm-1');
        expect(list).toEqual([created]);
      })
    );

    expect(calls).toHaveLength(2);
  });

  test('MetricsSample methods preserve sampledAt and limit handling', async () => {
    const iso = '2026-06-03T12:03:00.000Z';
    const samples = [
      { id: 'sample-1', machineName: 'vm-1', cpu: 1, memoryMb: 10, diskGb: 20, networkRxBytes: 30, networkTxBytes: 40, sampledAt: '2026-06-03T12:00:00.000Z' },
      { id: 'sample-2', machineName: 'vm-1', cpu: 2, memoryMb: 11, diskGb: 21, networkRxBytes: 31, networkTxBytes: 41, sampledAt: '2026-06-03T12:01:00.000Z' },
      { id: 'sample-3', machineName: 'vm-1', cpu: 3, memoryMb: 12, diskGb: 22, networkRxBytes: 32, networkTxBytes: 42, sampledAt: '2026-06-03T12:02:00.000Z' }
    ];
    const { fetchStub, calls } = createSequentialFetchStub([
      {
        method: 'POST',
        match: (url, body) => {
          if (url.pathname !== '/api/entities/MetricsSample') return false;
          const payload = parseJsonBody(body);
          expect(payload).toMatchObject({ machineName: 'vm-1', cpu: 1, sampledAt: iso });
          return true;
        },
        response: jsonResponse({
          id: 'sample-4',
          machineName: 'vm-1',
          cpu: 1,
          memoryMb: 10,
          diskGb: 20,
          networkRxBytes: 30,
          networkTxBytes: 40,
          sampledAt: iso
        })
      },
      {
        method: 'GET',
        match: (url) =>
          url.pathname === '/api/entities/MetricsSample' &&
          url.searchParams.get('filter') === 'machineName eq "vm-1"' &&
          url.searchParams.get('limit') === '2',
        response: jsonResponse({ data: samples })
      },
      {
        method: 'GET',
        match: (url) => url.pathname === '/api/entities/MetricsSample',
        response: jsonResponse({ data: samples })
      },
      {
        method: 'DELETE',
        match: (url) => url.pathname === '/api/entities/MetricsSample/sample-1',
        response: new Response(null, { status: 204 })
      }
    ]);

    await withFixedDate(iso, async () =>
      withPatchedFetch(fetchStub, async () => {
        const client = createManagerStoreClient();
        const inserted = await client.insertMetricsSample({
          machineName: 'vm-1',
          cpu: 1,
          memoryMb: 10,
          diskGb: 20,
          networkRxBytes: 30,
          networkTxBytes: 40
        });
        expect(inserted.sampledAt).toBe(iso);

        const list = await client.listMetricsSamples('vm-1', 2);
        expect(list).toHaveLength(3);

        const pruned = await client.pruneMetricsSamples('2026-06-03T12:00:30.000Z', 2);
        expect(pruned).toBe(1);
      })
    );

    expect(calls).toHaveLength(4);
  });

  test('AuditEvent methods preserve createdAt and limit handling', async () => {
    const iso = '2026-06-03T12:04:00.000Z';
    const events = [
      { id: 'audit-1', eventType: 'event-1', actorUserId: 'u1', action: 'do-1', details: 'd1', ipAddress: '127.0.0.1', createdAt: '2026-06-03T12:01:00.000Z' },
      { id: 'audit-2', eventType: 'event-2', actorUserId: 'u1', action: 'do-2', details: 'd2', ipAddress: null, createdAt: '2026-06-03T12:02:00.000Z' },
      { id: 'audit-3', eventType: 'event-3', actorUserId: null, action: null, details: null, ipAddress: null, createdAt: '2026-06-03T12:03:00.000Z' }
    ];
    const { fetchStub, calls } = createSequentialFetchStub([
      {
        method: 'POST',
        match: (url, body) => {
          if (url.pathname !== '/api/entities/AuditEvent') return false;
          const payload = parseJsonBody(body);
          expect(payload).toMatchObject({ eventType: 'login', createdAt: iso });
          return true;
        },
        response: jsonResponse({
          id: 'audit-4',
          eventType: 'login',
          actorUserId: 'u1',
          action: 'sign_in',
          details: 'Admin login',
          ipAddress: '127.0.0.1',
          createdAt: iso
        })
      },
      {
        method: 'GET',
        match: (url) => url.pathname === '/api/entities/AuditEvent' && url.searchParams.get('limit') === '2',
        response: jsonResponse({ data: events })
      },
      {
        method: 'GET',
        match: (url) => url.pathname === '/api/entities/AuditEvent',
        response: jsonResponse({ data: events })
      },
      {
        method: 'DELETE',
        match: (url) => url.pathname === '/api/entities/AuditEvent/audit-1',
        response: new Response(null, { status: 204 })
      }
    ]);

    await withFixedDate(iso, async () =>
      withPatchedFetch(fetchStub, async () => {
        const client = createManagerStoreClient();
        const inserted = await client.insertAuditEvent({
          eventType: 'login',
          actorUserId: 'u1',
          action: 'sign_in',
          details: 'Admin login',
          ipAddress: '127.0.0.1'
        });
        expect(inserted.createdAt).toBe(iso);

        const list = await client.listAuditEvents(2);
        expect(list).toHaveLength(3);

        const pruned = await client.pruneAuditEvents('2026-06-03T12:01:30.000Z', 2);
        expect(pruned).toBe(1);
      })
    );

    expect(calls).toHaveLength(4);
  });

  test('UiPreference methods preserve timestamps and reuse existing entries', async () => {
    const iso = '2026-06-03T12:05:00.000Z';
    const postedBodies: string[] = [];
    const { fetchStub, calls } = createSequentialFetchStub([
      {
        method: 'GET',
        match: (url) =>
          url.pathname === '/api/entities/UiPreference' &&
          url.searchParams.get('filter') === 'userId eq "user-1" and key eq "theme"',
        response: jsonResponse({ data: [] })
      },
      {
        method: 'GET',
        match: (url) =>
          url.pathname === '/api/entities/UiPreference' &&
          url.searchParams.get('filter') === 'userId eq "user-1" and key eq "theme"',
        response: jsonResponse({ data: [] })
      },
      {
        method: 'POST',
        match: (url) => url.pathname === '/api/entities/UiPreference',
        response: ({ body }) => {
          postedBodies.push(body ?? '');
          return jsonResponse({
            id: 'pref-1',
            userId: 'user-1',
            key: 'theme',
            valueJson: '"dark"',
            updatedAt: iso
          });
        }
      },
      {
        method: 'GET',
        match: (url) =>
          url.pathname === '/api/entities/UiPreference' &&
          url.searchParams.get('filter') === 'userId eq "user-1"',
        response: jsonResponse({
          data: [
            {
              id: 'pref-1',
              userId: 'user-1',
              key: 'theme',
              valueJson: '"dark"',
              updatedAt: iso
            }
          ]
        })
      },
      {
        method: 'GET',
        match: (url) =>
          url.pathname === '/api/entities/UiPreference' &&
          url.searchParams.get('filter') === 'userId eq "user-1" and key eq "theme"',
        response: jsonResponse({
          data: [
            {
              id: 'pref-1',
              userId: 'user-1',
              key: 'theme',
              valueJson: '"dark"',
              updatedAt: iso
            }
          ]
        })
      },
      {
        method: 'PATCH',
        match: (url) => url.pathname === '/api/entities/UiPreference/pref-1',
        response: ({ body }) => {
          postedBodies.push(body ?? '');
          return jsonResponse({
            id: 'pref-1',
            userId: 'user-1',
            key: 'theme',
            valueJson: '"light"',
            updatedAt: iso
          });
        }
      },
      {
        method: 'GET',
        match: (url) =>
          url.pathname === '/api/entities/UiPreference' &&
          url.searchParams.get('filter') === 'userId eq "user-1"',
        response: jsonResponse({
          data: [
            {
              id: 'pref-1',
              userId: 'user-1',
              key: 'theme',
              valueJson: '"light"',
              updatedAt: iso
            }
          ]
        })
      }
    ]);

    await withFixedDate(iso, async () =>
      withPatchedFetch(fetchStub, async () => {
        const client = createManagerStoreClient();

        await expect(client.getUiPreference('user-1', 'theme')).resolves.toBeNull();

        const created = await client.setUiPreference('user-1', 'theme', '"dark"');
        expect(created.updatedAt).toBe(iso);

        const list = await client.listUiPreferences('user-1');
        expect(list).toEqual([created]);

        const updated = await client.setUiPreference('user-1', 'theme', '"light"');
        expect(updated.valueJson).toBe('"light"');

        const refreshed = await client.listUiPreferences('user-1');
        expect(refreshed[0].valueJson).toBe('"light"');
      })
    );

    expect(calls).toHaveLength(7);
    expect(JSON.parse(postedBodies[0] ?? '{}')).toMatchObject({
      userId: 'user-1',
      key: 'theme',
      valueJson: '"dark"',
      updatedAt: iso
    });
    expect(JSON.parse(postedBodies[1] ?? '{}')).toMatchObject({
      valueJson: '"light"',
      updatedAt: iso
    });
  });
});

describe('mock parity', () => {
  test('ManagerSetting parity matches real client response shapes', async () => {
    const iso = '2026-06-03T13:00:00.000Z';
    await withFixedDate(iso, async () => {
      resetMockManagerStore();
      const mockClient = createMockManagerStoreClient();
      const mockCreated = await mockClient.setSetting('theme', '"dark"');
      const mockList = await mockClient.listSettings();

      const { fetchStub } = createSequentialFetchStub([
        {
          method: 'GET',
          match: (url) =>
            url.pathname === '/api/entities/ManagerSetting' &&
            url.searchParams.get('filter') === 'key eq "theme"',
          response: jsonResponse({ data: [] })
        },
        {
          method: 'POST',
          match: (url, body) => {
            if (url.pathname !== '/api/entities/ManagerSetting') return false;
            expect(parseJsonBody(body)).toMatchObject({ key: 'theme', valueJson: '"dark"', updatedAt: iso });
            return true;
          },
          response: jsonResponse({ id: 'setting-1', key: 'theme', valueJson: '"dark"', updatedAt: iso })
        },
        {
          method: 'GET',
          match: (url) => url.pathname === '/api/entities/ManagerSetting',
          response: jsonResponse({ data: [{ id: 'setting-1', key: 'theme', valueJson: '"dark"', updatedAt: iso }] })
        }
      ]);

      await withPatchedFetch(fetchStub, async () => {
        const realClient = createManagerStoreClient();
        const realCreated = await realClient.setSetting('theme', '"dark"');
        const realList = await realClient.listSettings();

        expect(withoutId(realCreated)).toEqual(withoutId(mockCreated));
        expect(realList.map(withoutId)).toEqual(mockList.map(withoutId));
      });
    });
  });

  test('SavedVmConfig parity matches real client response shapes', async () => {
    const iso = '2026-06-03T13:01:00.000Z';
    await withFixedDate(iso, async () => {
      resetMockManagerStore();
      const mockClient = createMockManagerStoreClient();
      const mockCreated = await mockClient.createSavedVmConfig({
        name: 'web-server',
        machineName: 'vm-web-01',
        configJson: '{"cpu":2}',
        toml: '[machine]\ncpu = 2'
      });

      const { fetchStub } = createSequentialFetchStub([
        {
          method: 'POST',
          match: (url, body) => {
            if (url.pathname !== '/api/entities/SavedVmConfig') return false;
            expect(parseJsonBody(body)).toMatchObject({
              name: 'web-server',
              machineName: 'vm-web-01',
              configJson: '{"cpu":2}',
              toml: '[machine]\ncpu = 2',
              createdAt: iso,
              updatedAt: iso
            });
            return true;
          },
          response: jsonResponse({
            id: 'cfg-1',
            name: 'web-server',
            machineName: 'vm-web-01',
            configJson: '{"cpu":2}',
            toml: '[machine]\ncpu = 2',
            createdAt: iso,
            updatedAt: iso
          })
        }
      ]);

      await withPatchedFetch(fetchStub, async () => {
        const realClient = createManagerStoreClient();
        const realCreated = await realClient.createSavedVmConfig({
          name: 'web-server',
          machineName: 'vm-web-01',
          configJson: '{"cpu":2}',
          toml: '[machine]\ncpu = 2'
        });
        expect(withoutId(realCreated)).toEqual(withoutId(mockCreated));
      });
    });
  });

  test('TomlSnapshot parity matches real client response shapes', async () => {
    const iso = '2026-06-03T13:02:00.000Z';
    await withFixedDate(iso, async () => {
      resetMockManagerStore();
      const mockClient = createMockManagerStoreClient();
      const mockCreated = await mockClient.createTomlSnapshot({
        machineName: 'vm-1',
        toml: '[machine]\ncpu = 1',
        reason: 'initial'
      });

      const { fetchStub } = createSequentialFetchStub([
        {
          method: 'POST',
          match: (url, body) => {
            if (url.pathname !== '/api/entities/TomlSnapshot') return false;
            expect(parseJsonBody(body)).toMatchObject({
              machineName: 'vm-1',
              toml: '[machine]\ncpu = 1',
              reason: 'initial',
              createdAt: iso
            });
            return true;
          },
          response: jsonResponse({
            id: 'snap-1',
            machineName: 'vm-1',
            toml: '[machine]\ncpu = 1',
            reason: 'initial',
            createdAt: iso
          })
        }
      ]);

      await withPatchedFetch(fetchStub, async () => {
        const realClient = createManagerStoreClient();
        const realCreated = await realClient.createTomlSnapshot({
          machineName: 'vm-1',
          toml: '[machine]\ncpu = 1',
          reason: 'initial'
        });
        expect(withoutId(realCreated)).toEqual(withoutId(mockCreated));
      });
    });
  });

  test('MetricsSample parity matches real client response shapes', async () => {
    const iso = '2026-06-03T13:03:00.000Z';
    await withFixedDate(iso, async () => {
      resetMockManagerStore();
      const mockClient = createMockManagerStoreClient();
      const mockCreated = await mockClient.insertMetricsSample({
        machineName: 'vm-1',
        cpu: 1,
        memoryMb: 10,
        diskGb: 20,
        networkRxBytes: 30,
        networkTxBytes: 40
      });

      const { fetchStub } = createSequentialFetchStub([
        {
          method: 'POST',
          match: (url, body) => {
            if (url.pathname !== '/api/entities/MetricsSample') return false;
            expect(parseJsonBody(body)).toMatchObject({ machineName: 'vm-1', cpu: 1, sampledAt: iso });
            return true;
          },
          response: jsonResponse({
            id: 'sample-1',
            machineName: 'vm-1',
            cpu: 1,
            memoryMb: 10,
            diskGb: 20,
            networkRxBytes: 30,
            networkTxBytes: 40,
            sampledAt: iso
          })
        }
      ]);

      await withPatchedFetch(fetchStub, async () => {
        const realClient = createManagerStoreClient();
        const realCreated = await realClient.insertMetricsSample({
          machineName: 'vm-1',
          cpu: 1,
          memoryMb: 10,
          diskGb: 20,
          networkRxBytes: 30,
          networkTxBytes: 40
        });
        expect(withoutId(realCreated)).toEqual(withoutId(mockCreated));
      });
    });
  });

  test('AuditEvent parity matches real client response shapes', async () => {
    const iso = '2026-06-03T13:04:00.000Z';
    await withFixedDate(iso, async () => {
      resetMockManagerStore();
      const mockClient = createMockManagerStoreClient();
      const mockCreated = await mockClient.insertAuditEvent({
        eventType: 'login',
        actorUserId: 'u1',
        action: 'sign_in',
        details: 'Admin login',
        ipAddress: '127.0.0.1'
      });

      const { fetchStub } = createSequentialFetchStub([
        {
          method: 'POST',
          match: (url, body) => {
            if (url.pathname !== '/api/entities/AuditEvent') return false;
            expect(parseJsonBody(body)).toMatchObject({ eventType: 'login', createdAt: iso });
            return true;
          },
          response: jsonResponse({
            id: 'audit-1',
            eventType: 'login',
            actorUserId: 'u1',
            action: 'sign_in',
            details: 'Admin login',
            ipAddress: '127.0.0.1',
            createdAt: iso
          })
        }
      ]);

      await withPatchedFetch(fetchStub, async () => {
        const realClient = createManagerStoreClient();
        const realCreated = await realClient.insertAuditEvent({
          eventType: 'login',
          actorUserId: 'u1',
          action: 'sign_in',
          details: 'Admin login',
          ipAddress: '127.0.0.1'
        });
        expect(withoutId(realCreated)).toEqual(withoutId(mockCreated));
      });
    });
  });

  test('UiPreference parity matches real client response shapes', async () => {
    const iso = '2026-06-03T13:05:00.000Z';
    await withFixedDate(iso, async () => {
      resetMockManagerStore();
      const mockClient = createMockManagerStoreClient();
      const mockCreated = await mockClient.setUiPreference('user-1', 'theme', '"dark"');

      const { fetchStub } = createSequentialFetchStub([
        {
          method: 'GET',
          match: (url) =>
            url.pathname === '/api/entities/UiPreference' &&
            url.searchParams.get('filter') === 'userId eq "user-1" and key eq "theme"',
          response: jsonResponse({ data: [] })
        },
        {
          method: 'POST',
          match: (url, body) => {
            if (url.pathname !== '/api/entities/UiPreference') return false;
            expect(parseJsonBody(body)).toMatchObject({
              userId: 'user-1',
              key: 'theme',
              valueJson: '"dark"',
              updatedAt: iso
            });
            return true;
          },
          response: jsonResponse({
            id: 'pref-1',
            userId: 'user-1',
            key: 'theme',
            valueJson: '"dark"',
            updatedAt: iso
          })
        }
      ]);

      await withPatchedFetch(fetchStub, async () => {
        const realClient = createManagerStoreClient();
        const realCreated = await realClient.setUiPreference('user-1', 'theme', '"dark"');
        expect(withoutId(realCreated)).toEqual(withoutId(mockCreated));
      });
    });
  });
});
});
