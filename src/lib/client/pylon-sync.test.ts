import { afterEach, describe, expect, test } from 'bun:test';
import {
  __setSyncEngineFactoryForTests,
  createMetricsHistorySync,
  createSavedVmConfigsSync,
  createUiPreferenceSync,
  getSyncEngine,
  stopSyncEngine
} from './pylon-sync';

type ReactiveMessage =
  { kind: 'result'; result: unknown } | { kind: 'error'; code: string; message: string };

type Subscription = {
  subId: string;
  fnName: string;
  args: unknown;
  handler: (message: ReactiveMessage) => void;
};

type Row = Record<string, unknown>;

type PageResult = { data: Row[]; total: number; hasMore: boolean };

class MockSyncEngine {
  subscriptions: Subscription[] = [];
  unsubscribed: string[] = [];
  fnCalls: Array<{ name: string; args: unknown }> = [];
  loadPageCalls: Array<{ entity: string; options: unknown }> = [];
  startCalls = 0;
  stopCalls = 0;
  fnResults = new Map<string, unknown>();
  loadPageResult: PageResult = { data: [], total: 0, hasMore: false };

  subscribeReactive(
    subId: string,
    fnName: string,
    args: unknown,
    handler: (message: ReactiveMessage) => void
  ): void {
    this.subscriptions.push({ subId, fnName, args, handler });
  }

  unsubscribeReactive(subId: string): void {
    this.unsubscribed.push(subId);
  }

  async loadPage(entity: string, options?: unknown) {
    this.loadPageCalls.push({ entity, options });
    return this.loadPageResult;
  }

  async fn<T = unknown>(name: string, args?: unknown): Promise<T> {
    this.fnCalls.push({ name, args });
    return this.fnResults.get(name) as T;
  }

  async start(): Promise<void> {
    this.startCalls += 1;
  }

  stop(): void {
    this.stopCalls += 1;
  }
}

const originalWindow = globalThis.window;

afterEach(() => {
  __setSyncEngineFactoryForTests(null);
  if (originalWindow === undefined) {
    delete (globalThis as { window?: Window }).window;
  } else {
    (globalThis as { window: Window }).window = originalWindow;
  }
});

function installWindow(origin = 'http://manager.test'): void {
  (globalThis as { window: Window }).window = { location: { origin } } as Window;
}

function createMetricsRow(index: number) {
  return {
    id: `sample-${index}`,
    machineName: 'vm-a',
    cpu: index,
    memoryMb: index * 10,
    diskGb: index,
    networkRxBytes: index,
    networkTxBytes: index,
    sampledAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString()
  };
}

describe('pylon client sync', () => {
  test('does not create a sync engine during SSR', async () => {
    delete (globalThis as { window?: Window }).window;
    let factoryCalls = 0;
    __setSyncEngineFactoryForTests(() => {
      factoryCalls += 1;
      return new MockSyncEngine();
    });

    expect(await getSyncEngine()).toBeNull();
    expect(factoryCalls).toBe(0);
  });

  test('lazy initializes the browser sync engine with session credentials', async () => {
    installWindow('http://manager.test');
    const mockEngine = new MockSyncEngine();
    const factoryCalls: Array<{ baseUrl?: string; options?: Record<string, unknown> }> = [];
    __setSyncEngineFactoryForTests((baseUrl, options) => {
      factoryCalls.push({ baseUrl, options });
      return mockEngine;
    });

    expect(await getSyncEngine()).toBe(mockEngine);
    expect(await getSyncEngine()).toBe(mockEngine);
    expect(factoryCalls).toEqual([
      {
        baseUrl: 'http://manager.test',
        options: {
          appName: 'smolvm-manager',
          persist: true,
          transport: { credentials: 'include' }
        }
      }
    ]);
    expect(mockEngine.startCalls).toBe(1);

    stopSyncEngine();
    expect(mockEngine.stopCalls).toBe(1);
  });

  test('syncs UiPreference through reactive subscription and setter action', async () => {
    installWindow();
    const mockEngine = new MockSyncEngine();
    mockEngine.fnResults.set('getUiPreference', {
      id: 'pref-1',
      userId: 'admin-1',
      key: 'dashboard.viewMode',
      valueJson: '"table"',
      updatedAt: '2026-01-01T00:00:00.000Z'
    });
    mockEngine.fnResults.set('setUiPreference', {
      id: 'pref-1',
      userId: 'admin-1',
      key: 'dashboard.viewMode',
      valueJson: '"cards"',
      updatedAt: '2026-01-01T00:01:00.000Z'
    });
    __setSyncEngineFactoryForTests(() => mockEngine);
    const values: string[] = [];

    const pref = createUiPreferenceSync('admin-1', 'dashboard.viewMode', {
      defaultValue: 'cards',
      onValue: (value) => values.push(value)
    });

    await pref.start();
    expect(pref.available).toBe(true);
    expect(pref.value).toBe('table');
    expect(values).toEqual(['table']);
    expect(mockEngine.subscriptions[0]).toMatchObject({
      fnName: 'getUiPreference',
      args: { userId: 'admin-1', key: 'dashboard.viewMode' }
    });

    mockEngine.subscriptions[0].handler({
      kind: 'result',
      result: { valueJson: '"cards"' }
    });
    expect(pref.value).toBe('cards');

    await pref.setValue('cards');
    expect(mockEngine.fnCalls.at(-1)).toEqual({
      name: 'setUiPreference',
      args: { userId: 'admin-1', key: 'dashboard.viewMode', valueJson: '"cards"' }
    });

    pref.stop();
    expect(mockEngine.unsubscribed).toEqual([mockEngine.subscriptions[0].subId]);
  });

  test('loads SavedVmConfig rows with loadPage and reactive list updates', async () => {
    installWindow();
    const mockEngine = new MockSyncEngine();
    mockEngine.loadPageResult = {
      data: [
        {
          id: 'config-1',
          name: 'dev',
          machineName: 'vm-a',
          configJson: '{}',
          toml: 'name = "vm-a"',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ],
      total: 1,
      hasMore: false
    };
    __setSyncEngineFactoryForTests(() => mockEngine);
    const updates: string[][] = [];
    const configs = createSavedVmConfigsSync({
      onConfigs: (rows) => updates.push(rows.map((row) => row.name))
    });

    await configs.start();

    expect(configs.configs.map((row) => row.name)).toEqual(['dev']);
    expect(mockEngine.loadPageCalls).toEqual([
      { entity: 'SavedVmConfig', options: { order: { updatedAt: 'desc' } } }
    ]);
    expect(mockEngine.subscriptions[0].fnName).toBe('listSavedVmConfigs');

    mockEngine.subscriptions[0].handler({
      kind: 'result',
      result: [{ ...mockEngine.loadPageResult.data[0], id: 'config-2', name: 'prod' }]
    });
    expect(updates.at(-1)).toEqual(['prod']);
  });

  test('bounds MetricsSample history to 100 rows and keeps API-compatible args', async () => {
    installWindow();
    const mockEngine = new MockSyncEngine();
    const rows = Array.from({ length: 105 }, (_, index) => createMetricsRow(index));
    mockEngine.fnResults.set('listMetricsSamples', rows);
    __setSyncEngineFactoryForTests(() => mockEngine);
    const updates: number[] = [];
    const history = createMetricsHistorySync({
      machineName: 'vm-a',
      limit: 120,
      onSamples: (samples) => updates.push(samples.length)
    });

    await history.start();

    expect(history.samples).toHaveLength(100);
    expect(history.samples[0].id).toBe('sample-5');
    expect(history.samples.at(-1)?.id).toBe('sample-104');
    expect(mockEngine.fnCalls[0]).toEqual({
      name: 'listMetricsSamples',
      args: { machineName: 'vm-a', limit: 100 }
    });
    expect(mockEngine.subscriptions[0]).toMatchObject({
      fnName: 'listMetricsSamples',
      args: { machineName: 'vm-a', limit: 100 }
    });

    mockEngine.subscriptions[0].handler({
      kind: 'result',
      result: [createMetricsRow(200), createMetricsRow(199)]
    });
    expect(history.samples.map((sample) => sample.id)).toEqual(['sample-199', 'sample-200']);
    expect(updates).toEqual([100, 2]);
  });
});
