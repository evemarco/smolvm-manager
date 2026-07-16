import type { MetricsSample } from '$lib/types';

type Row = Record<string, unknown>;

type ReactiveMessage =
  { kind: 'result'; result: unknown } | { kind: 'error'; code: string; message: string };

type SyncEngine = {
  subscribeReactive(
    subId: string,
    fnName: string,
    args: unknown,
    handler: (msg: ReactiveMessage) => void
  ): void;
  unsubscribeReactive(subId: string): void;
  loadPage(
    entity: string,
    options?: { limit?: number; offset?: number; order?: Record<string, 'asc' | 'desc'> }
  ): Promise<{ data: Row[]; total: number; hasMore: boolean }>;
  fn<T = unknown>(name: string, args?: unknown): Promise<T>;
  start(): Promise<void>;
  stop(): void;
};

type SyncModule = {
  createSyncEngine(baseUrl?: string, options?: Record<string, unknown>): SyncEngine;
};

export type UiPreference = {
  id: string;
  userId: string;
  key: string;
  valueJson: string;
  updatedAt: string;
};

export type SavedVmConfig = {
  id: string;
  name: string;
  machineName: string;
  configJson: string;
  toml: string;
  createdAt: string;
  updatedAt: string;
};

type BaseSyncController = {
  start(): Promise<void>;
  refresh(): Promise<void>;
  stop(): void;
  readonly available: boolean;
  readonly error: string | null;
};

export type UiPreferenceSync<T> = BaseSyncController & {
  readonly value: T;
  setValue(value: T): Promise<void>;
};

export type SavedVmConfigsSync = BaseSyncController & {
  readonly configs: SavedVmConfig[];
};

export type MetricsHistorySync = BaseSyncController & {
  readonly samples: MetricsSample[];
};

type UiPreferenceOptions<T> = {
  defaultValue: T;
  onValue?: (value: T) => void;
  parse?: (valueJson: string) => T;
  serialize?: (value: T) => string;
};

type SavedVmConfigsOptions = {
  onConfigs?: (configs: SavedVmConfig[]) => void;
};

type MetricsHistoryOptions = {
  machineName?: string;
  limit?: number;
  onSamples?: (samples: MetricsSample[]) => void;
};

let engine: SyncEngine | null = null;
let enginePromise: Promise<SyncEngine | null> | null = null;
let syncModulePromise: Promise<SyncModule> | null = null;
let engineFactoryOverride: SyncModule['createSyncEngine'] | null = null;
let subCounter = 0;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function getBaseUrl(): string {
  return isBrowser() ? window.location.origin : 'http://localhost:3000';
}

async function loadSyncModule(): Promise<SyncModule> {
  if (engineFactoryOverride) {
    return { createSyncEngine: engineFactoryOverride };
  }
  syncModulePromise ??= import('@pylonsync/sync') as Promise<SyncModule>;
  return syncModulePromise;
}

export async function getSyncEngine(): Promise<SyncEngine | null> {
  if (!isBrowser()) return null;
  if (engine) return engine;
  if (enginePromise) return enginePromise;

  enginePromise = loadSyncModule()
    .then(({ createSyncEngine }) => {
      engine = createSyncEngine(getBaseUrl(), {
        appName: 'smolvm-manager',
        persist: true,
        transport: { credentials: 'include' }
      });
      engine.start().catch(() => {});
      return engine;
    })
    .catch(() => null)
    .finally(() => {
      enginePromise = null;
    });

  return enginePromise;
}

export function stopSyncEngine(): void {
  engine?.stop();
  engine = null;
  enginePromise = null;
}

export function __setSyncEngineFactoryForTests(
  factory: SyncModule['createSyncEngine'] | null
): void {
  stopSyncEngine();
  engineFactoryOverride = factory;
  syncModulePromise = null;
}

function nextSubId(prefix: string): string {
  subCounter += 1;
  return `${prefix}:${subCounter}`;
}

function defaultParse<T>(valueJson: string): T {
  return JSON.parse(valueJson) as T;
}

function defaultSerialize<T>(value: T): string {
  return JSON.stringify(value);
}

function getRows(result: unknown): Row[] {
  if (Array.isArray(result)) return result.filter(isRow);
  if (isRow(result)) {
    const data = result.data ?? result.rows ?? result.samples ?? result.configs;
    if (Array.isArray(data)) return data.filter(isRow);
  }
  return [];
}

function firstRow(result: unknown): Row | null {
  if (result === null || result === undefined) return null;
  if (isRow(result)) return result;
  return getRows(result)[0] ?? null;
}

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeSavedVmConfig(row: Row): SavedVmConfig {
  return {
    id: asString(row.id),
    name: asString(row.name),
    machineName: asString(row.machineName),
    configJson: asString(row.configJson),
    toml: asString(row.toml),
    createdAt: asString(row.createdAt),
    updatedAt: asString(row.updatedAt)
  };
}

function normalizeMetricsSample(row: Row): MetricsSample {
  return {
    id: asString(row.id),
    machineName: asOptionalString(row.machineName),
    cpu: asNumber(row.cpu),
    memoryMb: asNumber(row.memoryMb),
    diskGb: asNumber(row.diskGb),
    networkRxBytes: asNumber(row.networkRxBytes),
    networkTxBytes: asNumber(row.networkTxBytes),
    sampledAt: asString(row.sampledAt)
  };
}

function sortMetricsSamples(samples: MetricsSample[], limit: number): MetricsSample[] {
  return [...samples]
    .sort((a, b) => new Date(a.sampledAt).getTime() - new Date(b.sampledAt).getTime())
    .slice(-limit);
}

export function createUiPreferenceSync<T>(
  userId: string | null | undefined,
  key: string,
  options: UiPreferenceOptions<T>
): UiPreferenceSync<T> {
  const parse = options.parse ?? defaultParse<T>;
  const serialize = options.serialize ?? defaultSerialize<T>;
  let current = options.defaultValue;
  let currentEngine: SyncEngine | null = null;
  let subId: string | null = null;
  let available = false;
  let error: string | null = null;

  function applyValue(value: T): void {
    current = value;
    options.onValue?.(value);
  }

  function applyPreference(row: Row | null): void {
    if (!row || typeof row.valueJson !== 'string') return;
    applyValue(parse(row.valueJson));
  }

  async function refresh(): Promise<void> {
    if (!userId || !currentEngine) return;
    try {
      const result = await currentEngine.fn('getUiPreference', { userId, key });
      applyPreference(firstRow(result));
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'UiPreference sync unavailable';
    }
  }

  return {
    get value() {
      return current;
    },
    get available() {
      return available;
    },
    get error() {
      return error;
    },
    async start() {
      if (!userId || currentEngine) return;
      currentEngine = await getSyncEngine();
      available = currentEngine !== null;
      if (!currentEngine) return;

      subId = nextSubId(`ui-preference:${userId}:${key}`);
      currentEngine.subscribeReactive(subId, 'getUiPreference', { userId, key }, (msg) => {
        if (msg.kind === 'error') {
          error = msg.message;
          return;
        }
        applyPreference(firstRow(msg.result));
        error = null;
      });
      await refresh();
    },
    refresh,
    stop() {
      if (currentEngine && subId) currentEngine.unsubscribeReactive(subId);
      subId = null;
      currentEngine = null;
      available = false;
    },
    async setValue(value: T) {
      applyValue(value);
      if (!userId) return;
      currentEngine ??= await getSyncEngine();
      available = currentEngine !== null;
      if (!currentEngine) return;

      try {
        const result = await currentEngine.fn('setUiPreference', {
          userId,
          key,
          valueJson: serialize(value)
        });
        applyPreference(firstRow(result));
        error = null;
      } catch (err) {
        error = err instanceof Error ? err.message : 'UiPreference sync unavailable';
      }
    }
  };
}

export function createSavedVmConfigsSync(options: SavedVmConfigsOptions = {}): SavedVmConfigsSync {
  let configs: SavedVmConfig[] = [];
  let currentEngine: SyncEngine | null = null;
  let subId: string | null = null;
  let available = false;
  let error: string | null = null;

  function applyConfigs(rows: Row[]): void {
    configs = rows.map(normalizeSavedVmConfig);
    options.onConfigs?.(configs);
  }

  async function refresh(): Promise<void> {
    if (!currentEngine) return;
    try {
      const page = await currentEngine.loadPage('SavedVmConfig', {
        order: { updatedAt: 'desc' }
      });
      applyConfigs(page.data);
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Saved VM config sync unavailable';
    }
  }

  return {
    get configs() {
      return configs;
    },
    get available() {
      return available;
    },
    get error() {
      return error;
    },
    async start() {
      if (currentEngine) return;
      currentEngine = await getSyncEngine();
      available = currentEngine !== null;
      if (!currentEngine) return;

      subId = nextSubId('saved-vm-configs');
      currentEngine.subscribeReactive(subId, 'listSavedVmConfigs', {}, (msg) => {
        if (msg.kind === 'error') {
          error = msg.message;
          return;
        }
        applyConfigs(getRows(msg.result));
        error = null;
      });
      await refresh();
    },
    refresh,
    stop() {
      if (currentEngine && subId) currentEngine.unsubscribeReactive(subId);
      subId = null;
      currentEngine = null;
      available = false;
    }
  };
}

export function createMetricsHistorySync({
  machineName,
  limit = 100,
  onSamples
}: MetricsHistoryOptions = {}): MetricsHistorySync {
  let samples: MetricsSample[] = [];
  let currentEngine: SyncEngine | null = null;
  let subId: string | null = null;
  let available = false;
  let error: string | null = null;
  const boundedLimit = Math.min(Math.max(limit, 1), 100);
  const args = { machineName, limit: boundedLimit };

  function applySamples(rows: Row[]): void {
    samples = sortMetricsSamples(rows.map(normalizeMetricsSample), boundedLimit);
    onSamples?.(samples);
  }

  async function refresh(): Promise<void> {
    if (!currentEngine) return;
    try {
      const result = await currentEngine.fn('listMetricsSamples', args);
      applySamples(getRows(result));
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Metrics history sync unavailable';
    }
  }

  return {
    get samples() {
      return samples;
    },
    get available() {
      return available;
    },
    get error() {
      return error;
    },
    async start() {
      if (currentEngine) return;
      currentEngine = await getSyncEngine();
      available = currentEngine !== null;
      if (!currentEngine) return;

      subId = nextSubId(`metrics-history:${machineName ?? 'all'}`);
      currentEngine.subscribeReactive(subId, 'listMetricsSamples', args, (msg) => {
        if (msg.kind === 'error') {
          error = msg.message;
          return;
        }
        applySamples(getRows(msg.result));
        error = null;
      });
      await refresh();
    },
    refresh,
    stop() {
      if (currentEngine && subId) currentEngine.unsubscribeReactive(subId);
      subId = null;
      currentEngine = null;
      available = false;
    }
  };
}
