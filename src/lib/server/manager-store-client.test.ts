import { expect, test, beforeEach, describe } from 'bun:test';
import manifest from '../../../app.ts';
import {
  createMockManagerStoreClient,
  createManagerStoreClient,
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

// ---------------------------------------------------------------------------
// Real client error handling
// ---------------------------------------------------------------------------

describe('real client error handling', () => {
  test('Pylon unavailable throws structured store error', async () => {
    const originalEnv = process.env.PYLON_URL;
    process.env.PYLON_URL = 'http://127.0.0.1:59999';

    const client = createManagerStoreClient();
    try {
      await client.listSettings();
      throw new Error('Expected listSettings to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ManagerStoreError);
      const storeError = error as ManagerStoreError;
      expect(storeError.code).toBe(STORE_ERROR_CODES.UNAVAILABLE);
      expect(storeError.status).toBe(503);
      expect(storeError.message).toContain('unreachable');
    } finally {
      process.env.PYLON_URL = originalEnv;
    }
  });
});
