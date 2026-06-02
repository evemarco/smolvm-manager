/**
 * Manager Store Client Abstraction
 *
 * Narrow Pylon-backed client for manager metadata entities:
 * ManagerSetting, SavedVmConfig, TomlSnapshot, MetricsSample,
 * UiPreference, and AuditEvent.
 *
 * In test environments, set PYLON_STORE_MOCK=true to use the
 * in-memory mock implementation instead of real HTTP calls.
 */

export const STORE_ERROR_CODES = {
  UNAVAILABLE: 'STORE_UNAVAILABLE',
  NOT_FOUND: 'STORE_NOT_FOUND',
  VALIDATION: 'STORE_VALIDATION',
  REQUEST_FAILED: 'STORE_REQUEST_FAILED'
} as const;

export type ManagerStoreErrorCode = (typeof STORE_ERROR_CODES)[keyof typeof STORE_ERROR_CODES];

export class ManagerStoreError extends Error {
  code: ManagerStoreErrorCode;
  status: number;
  details?: unknown;

  constructor(code: ManagerStoreErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ManagerStoreError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type ManagerSetting = {
  id: string;
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

export type TomlSnapshot = {
  id: string;
  machineName: string;
  toml: string;
  reason: string | null;
  createdAt: string;
};

export type MetricsSample = {
  id: string;
  machineName: string | null;
  cpu: number;
  memoryMb: number;
  diskGb: number;
  networkRxBytes: number;
  networkTxBytes: number;
  sampledAt: string;
};

export type AuditEvent = {
  id: string;
  eventType: string;
  actorUserId: string | null;
  action: string | null;
  details: string | null;
  ipAddress: string | null;
  createdAt: string;
};

export type UiPreference = {
  id: string;
  userId: string;
  key: string;
  valueJson: string;
  updatedAt: string;
};

export interface ManagerStoreClient {
  // ManagerSetting
  getSetting(key: string): Promise<ManagerSetting | null>;
  setSetting(key: string, valueJson: string): Promise<ManagerSetting>;
  listSettings(): Promise<ManagerSetting[]>;

  // SavedVmConfig
  createSavedVmConfig(data: {
    name: string;
    machineName: string;
    configJson: string;
    toml: string;
  }): Promise<SavedVmConfig>;
  getSavedVmConfig(id: string): Promise<SavedVmConfig | null>;
  listSavedVmConfigs(): Promise<SavedVmConfig[]>;
  updateSavedVmConfig(
    id: string,
    data: Partial<{
      name: string;
      machineName: string;
      configJson: string;
      toml: string;
    }>
  ): Promise<SavedVmConfig>;
  deleteSavedVmConfig(id: string): Promise<void>;

  // TomlSnapshot
  createTomlSnapshot(data: {
    machineName: string;
    toml: string;
    reason?: string;
  }): Promise<TomlSnapshot>;
  listTomlSnapshots(machineName?: string): Promise<TomlSnapshot[]>;

  // MetricsSample
  insertMetricsSample(data: {
    machineName?: string;
    cpu: number;
    memoryMb: number;
    diskGb: number;
    networkRxBytes: number;
    networkTxBytes: number;
  }): Promise<MetricsSample>;
  listMetricsSamples(machineName?: string, limit?: number): Promise<MetricsSample[]>;
  pruneMetricsSamples(beforeDate?: string, maxCount?: number): Promise<number>;

  // AuditEvent
  insertAuditEvent(data: {
    eventType: string;
    actorUserId?: string;
    action?: string;
    details?: string;
    ipAddress?: string;
  }): Promise<AuditEvent>;
  listAuditEvents(limit?: number): Promise<AuditEvent[]>;
  pruneAuditEvents(beforeDate?: string, maxCount?: number): Promise<number>;

  // UiPreference
  getUiPreference(userId: string, key: string): Promise<UiPreference | null>;
  setUiPreference(userId: string, key: string, valueJson: string): Promise<UiPreference>;
  listUiPreferences(userId: string): Promise<UiPreference[]>;
}

function getPylonBaseUrl(): string {
  return process.env.PYLON_URL?.trim() || 'http://127.0.0.1:3001';
}

async function pylonFetchJson(
  path: string,
  init: RequestInit
): Promise<{ status: number; body: unknown }> {
  const baseUrl = getPylonBaseUrl();
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };

  try {
    const response = await fetch(url, {
      ...init,
      headers,
      redirect: 'manual'
    });

    let body: unknown = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const text = await response.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }

    return { status: response.status, body };
  } catch {
    throw new ManagerStoreError(STORE_ERROR_CODES.UNAVAILABLE, 'Pylon store is unreachable.', 503);
  }
}

function assertObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ManagerStoreError(
      STORE_ERROR_CODES.REQUEST_FAILED,
      'Pylon returned an invalid response shape.',
      502
    );
  }
  return value as Record<string, unknown>;
}

function asList(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== 'object') return [];
  const obj = value as Record<string, unknown>;
  const data = obj.data;
  if (Array.isArray(data)) return data.map(assertObject);
  if (Array.isArray(obj)) return obj.map(assertObject);
  return [];
}

function asSetting(row: Record<string, unknown>): ManagerSetting {
  return {
    id: String(row.id),
    key: String(row.key),
    valueJson: String(row.valueJson),
    updatedAt: String(row.updatedAt)
  };
}

function asSavedVmConfig(row: Record<string, unknown>): SavedVmConfig {
  return {
    id: String(row.id),
    name: String(row.name),
    machineName: String(row.machineName),
    configJson: String(row.configJson),
    toml: String(row.toml),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}

function asTomlSnapshot(row: Record<string, unknown>): TomlSnapshot {
  return {
    id: String(row.id),
    machineName: String(row.machineName),
    toml: String(row.toml),
    reason: row.reason == null ? null : String(row.reason),
    createdAt: String(row.createdAt)
  };
}

function asMetricsSample(row: Record<string, unknown>): MetricsSample {
  return {
    id: String(row.id),
    machineName: row.machineName == null ? null : String(row.machineName),
    cpu: Number(row.cpu),
    memoryMb: Number(row.memoryMb),
    diskGb: Number(row.diskGb),
    networkRxBytes: Number(row.networkRxBytes),
    networkTxBytes: Number(row.networkTxBytes),
    sampledAt: String(row.sampledAt)
  };
}

function asAuditEvent(row: Record<string, unknown>): AuditEvent {
  return {
    id: String(row.id),
    eventType: String(row.eventType),
    actorUserId: row.actorUserId == null ? null : String(row.actorUserId),
    action: row.action == null ? null : String(row.action),
    details: row.details == null ? null : String(row.details),
    ipAddress: row.ipAddress == null ? null : String(row.ipAddress),
    createdAt: String(row.createdAt)
  };
}

function asUiPreference(row: Record<string, unknown>): UiPreference {
  return {
    id: String(row.id),
    userId: String(row.userId),
    key: String(row.key),
    valueJson: String(row.valueJson),
    updatedAt: String(row.updatedAt)
  };
}

export function createManagerStoreClient(): ManagerStoreClient {
  return {
    async getSetting(key) {
      const { status, body } = await pylonFetchJson(
        `/api/entities/ManagerSetting?filter=key eq "${encodeURIComponent(key)}"`,
        { method: 'GET' }
      );
      if (status !== 200) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to fetch setting.',
          status
        );
      }
      const list = asList(body);
      if (list.length === 0) return null;
      return asSetting(list[0]);
    },

    async setSetting(key, valueJson) {
      const existing = await this.getSetting(key);
      if (existing) {
        const { status, body } = await pylonFetchJson(
          `/api/entities/ManagerSetting/${existing.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ valueJson, updatedAt: new Date().toISOString() })
          }
        );
        if (status !== 200) {
          throw new ManagerStoreError(
            STORE_ERROR_CODES.REQUEST_FAILED,
            'Failed to update setting.',
            status
          );
        }
        return asSetting(assertObject(body));
      }
      const { status, body } = await pylonFetchJson('/api/entities/ManagerSetting', {
        method: 'POST',
        body: JSON.stringify({ key, valueJson, updatedAt: new Date().toISOString() })
      });
      if (status !== 200 && status !== 201) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to create setting.',
          status
        );
      }
      return asSetting(assertObject(body));
    },

    async listSettings() {
      const { status, body } = await pylonFetchJson('/api/entities/ManagerSetting', {
        method: 'GET'
      });
      if (status !== 200) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to list settings.',
          status
        );
      }
      return asList(body).map(asSetting);
    },

    async createSavedVmConfig(data) {
      const now = new Date().toISOString();
      const { status, body } = await pylonFetchJson('/api/entities/SavedVmConfig', {
        method: 'POST',
        body: JSON.stringify({ ...data, createdAt: now, updatedAt: now })
      });
      if (status !== 200 && status !== 201) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to create saved VM config.',
          status
        );
      }
      return asSavedVmConfig(assertObject(body));
    },

    async getSavedVmConfig(id) {
      const { status, body } = await pylonFetchJson(`/api/entities/SavedVmConfig/${id}`, {
        method: 'GET'
      });
      if (status === 404) return null;
      if (status !== 200) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to fetch saved VM config.',
          status
        );
      }
      return asSavedVmConfig(assertObject(body));
    },

    async listSavedVmConfigs() {
      const { status, body } = await pylonFetchJson('/api/entities/SavedVmConfig', {
        method: 'GET'
      });
      if (status !== 200) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to list saved VM configs.',
          status
        );
      }
      return asList(body).map(asSavedVmConfig);
    },

    async updateSavedVmConfig(id, data) {
      const { status, body } = await pylonFetchJson(`/api/entities/SavedVmConfig/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...data, updatedAt: new Date().toISOString() })
      });
      if (status !== 200) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to update saved VM config.',
          status
        );
      }
      return asSavedVmConfig(assertObject(body));
    },

    async deleteSavedVmConfig(id) {
      const { status } = await pylonFetchJson(`/api/entities/SavedVmConfig/${id}`, {
        method: 'DELETE'
      });
      if (status !== 200 && status !== 204) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to delete saved VM config.',
          status
        );
      }
    },

    async createTomlSnapshot(data) {
      const { status, body } = await pylonFetchJson('/api/entities/TomlSnapshot', {
        method: 'POST',
        body: JSON.stringify({ ...data, createdAt: new Date().toISOString() })
      });
      if (status !== 200 && status !== 201) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to create TOML snapshot.',
          status
        );
      }
      return asTomlSnapshot(assertObject(body));
    },

    async listTomlSnapshots(machineName) {
      const path = machineName
        ? `/api/entities/TomlSnapshot?filter=machineName eq "${encodeURIComponent(machineName)}"`
        : '/api/entities/TomlSnapshot';
      const { status, body } = await pylonFetchJson(path, { method: 'GET' });
      if (status !== 200) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to list TOML snapshots.',
          status
        );
      }
      return asList(body).map(asTomlSnapshot);
    },

    async insertMetricsSample(data) {
      const { status, body } = await pylonFetchJson('/api/entities/MetricsSample', {
        method: 'POST',
        body: JSON.stringify({ ...data, sampledAt: new Date().toISOString() })
      });
      if (status !== 200 && status !== 201) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to insert metrics sample.',
          status
        );
      }
      return asMetricsSample(assertObject(body));
    },

    async listMetricsSamples(machineName, limit) {
      let path = '/api/entities/MetricsSample';
      const params = new URLSearchParams();
      if (machineName)
        params.append('filter', `machineName eq "${encodeURIComponent(machineName)}"`);
      if (limit) params.append('limit', String(limit));
      if (params.toString()) path += `?${params.toString()}`;
      const { status, body } = await pylonFetchJson(path, { method: 'GET' });
      if (status !== 200) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to list metrics samples.',
          status
        );
      }
      return asList(body).map(asMetricsSample);
    },

    async pruneMetricsSamples(beforeDate, maxCount) {
      const samples = await this.listMetricsSamples();
      let toDelete = samples;
      if (beforeDate) {
        const cutoff = new Date(beforeDate).getTime();
        toDelete = toDelete.filter((s) => new Date(s.sampledAt).getTime() < cutoff);
      }
      if (maxCount && samples.length > maxCount) {
        const sorted = [...samples].sort(
          (a, b) => new Date(a.sampledAt).getTime() - new Date(b.sampledAt).getTime()
        );
        toDelete = sorted.slice(0, samples.length - maxCount);
      }
      for (const s of toDelete) {
        await pylonFetchJson(`/api/entities/MetricsSample/${s.id}`, { method: 'DELETE' });
      }
      return toDelete.length;
    },

    async insertAuditEvent(data) {
      const { status, body } = await pylonFetchJson('/api/entities/AuditEvent', {
        method: 'POST',
        body: JSON.stringify({ ...data, createdAt: new Date().toISOString() })
      });
      if (status !== 200 && status !== 201) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to insert audit event.',
          status
        );
      }
      return asAuditEvent(assertObject(body));
    },

    async listAuditEvents(limit) {
      const path = limit ? `/api/entities/AuditEvent?limit=${limit}` : '/api/entities/AuditEvent';
      const { status, body } = await pylonFetchJson(path, { method: 'GET' });
      if (status !== 200) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to list audit events.',
          status
        );
      }
      return asList(body).map(asAuditEvent);
    },

    async pruneAuditEvents(beforeDate, maxCount) {
      const events = await this.listAuditEvents();
      let toDelete = events;
      if (beforeDate) {
        const cutoff = new Date(beforeDate).getTime();
        toDelete = toDelete.filter((e) => new Date(e.createdAt).getTime() < cutoff);
      }
      if (maxCount && events.length > maxCount) {
        const sorted = [...events].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        toDelete = sorted.slice(0, events.length - maxCount);
      }
      for (const e of toDelete) {
        await pylonFetchJson(`/api/entities/AuditEvent/${e.id}`, { method: 'DELETE' });
      }
      return toDelete.length;
    },

    async getUiPreference(userId, key) {
      const { status, body } = await pylonFetchJson(
        `/api/entities/UiPreference?filter=userId eq "${encodeURIComponent(userId)}" and key eq "${encodeURIComponent(key)}"`,
        { method: 'GET' }
      );
      if (status !== 200) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to fetch UI preference.',
          status
        );
      }
      const list = asList(body);
      if (list.length === 0) return null;
      return asUiPreference(list[0]);
    },

    async setUiPreference(userId, key, valueJson) {
      const existing = await this.getUiPreference(userId, key);
      if (existing) {
        const { status, body } = await pylonFetchJson(`/api/entities/UiPreference/${existing.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ valueJson, updatedAt: new Date().toISOString() })
        });
        if (status !== 200) {
          throw new ManagerStoreError(
            STORE_ERROR_CODES.REQUEST_FAILED,
            'Failed to update UI preference.',
            status
          );
        }
        return asUiPreference(assertObject(body));
      }
      const { status, body } = await pylonFetchJson('/api/entities/UiPreference', {
        method: 'POST',
        body: JSON.stringify({ userId, key, valueJson, updatedAt: new Date().toISOString() })
      });
      if (status !== 200 && status !== 201) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to create UI preference.',
          status
        );
      }
      return asUiPreference(assertObject(body));
    },

    async listUiPreferences(userId) {
      const { status, body } = await pylonFetchJson(
        `/api/entities/UiPreference?filter=userId eq "${encodeURIComponent(userId)}"`,
        { method: 'GET' }
      );
      if (status !== 200) {
        throw new ManagerStoreError(
          STORE_ERROR_CODES.REQUEST_FAILED,
          'Failed to list UI preferences.',
          status
        );
      }
      return asList(body).map(asUiPreference);
    }
  };
}

// ---------------------------------------------------------------------------
// Mock implementation for tests and environments without Pylon
// ---------------------------------------------------------------------------

let mockSettings: ManagerSetting[] = [];
let mockSavedVmConfigs: SavedVmConfig[] = [];
let mockTomlSnapshots: TomlSnapshot[] = [];
let mockMetricsSamples: MetricsSample[] = [];
let mockAuditEvents: AuditEvent[] = [];
let mockUiPreferences: UiPreference[] = [];
let mockIdCounter = 1;

function nextId(): string {
  return String(mockIdCounter++);
}

export function resetMockManagerStore(): void {
  mockSettings = [];
  mockSavedVmConfigs = [];
  mockTomlSnapshots = [];
  mockMetricsSamples = [];
  mockAuditEvents = [];
  mockUiPreferences = [];
  mockIdCounter = 1;
}

export function createMockManagerStoreClient(): ManagerStoreClient {
  return {
    async getSetting(key) {
      const found = mockSettings.find((s) => s.key === key);
      return found ? { ...found } : null;
    },

    async setSetting(key, valueJson) {
      const existing = mockSettings.find((s) => s.key === key);
      const now = new Date().toISOString();
      if (existing) {
        existing.valueJson = valueJson;
        existing.updatedAt = now;
        return { ...existing };
      }
      const created: ManagerSetting = { id: nextId(), key, valueJson, updatedAt: now };
      mockSettings.push(created);
      return { ...created };
    },

    async listSettings() {
      return mockSettings.map((s) => ({ ...s }));
    },

    async createSavedVmConfig(data) {
      const now = new Date().toISOString();
      const created: SavedVmConfig = { id: nextId(), ...data, createdAt: now, updatedAt: now };
      mockSavedVmConfigs.push(created);
      return { ...created };
    },

    async getSavedVmConfig(id) {
      const found = mockSavedVmConfigs.find((c) => c.id === id);
      return found ? { ...found } : null;
    },

    async listSavedVmConfigs() {
      return mockSavedVmConfigs.map((c) => ({ ...c }));
    },

    async updateSavedVmConfig(id, data) {
      const found = mockSavedVmConfigs.find((c) => c.id === id);
      if (!found) {
        throw new ManagerStoreError(STORE_ERROR_CODES.NOT_FOUND, 'Saved VM config not found.', 404);
      }
      Object.assign(found, data, { updatedAt: new Date().toISOString() });
      return { ...found };
    },

    async deleteSavedVmConfig(id) {
      const idx = mockSavedVmConfigs.findIndex((c) => c.id === id);
      if (idx !== -1) mockSavedVmConfigs.splice(idx, 1);
    },

    async createTomlSnapshot(data) {
      const now = new Date().toISOString();
      const created: TomlSnapshot = {
        id: nextId(),
        machineName: data.machineName,
        toml: data.toml,
        reason: data.reason ?? null,
        createdAt: now
      };
      mockTomlSnapshots.push(created);
      return { ...created };
    },

    async listTomlSnapshots(machineName) {
      let list = mockTomlSnapshots.map((s) => ({ ...s }));
      if (machineName) {
        list = list.filter((s) => s.machineName === machineName);
      }
      return list;
    },

    async insertMetricsSample(data) {
      const now = new Date().toISOString();
      const created: MetricsSample = {
        id: nextId(),
        machineName: data.machineName ?? null,
        cpu: data.cpu,
        memoryMb: data.memoryMb,
        diskGb: data.diskGb,
        networkRxBytes: data.networkRxBytes,
        networkTxBytes: data.networkTxBytes,
        sampledAt: now
      };
      mockMetricsSamples.push(created);
      return { ...created };
    },

    async listMetricsSamples(machineName, limit) {
      let list = mockMetricsSamples.map((s) => ({ ...s }));
      if (machineName) {
        list = list.filter((s) => s.machineName === machineName);
      }
      if (limit) {
        list = list.slice(-limit);
      }
      return list;
    },

    async pruneMetricsSamples(beforeDate, maxCount) {
      let toDelete = [...mockMetricsSamples];
      if (beforeDate) {
        const cutoff = new Date(beforeDate).getTime();
        toDelete = toDelete.filter((s) => new Date(s.sampledAt).getTime() < cutoff);
      }
      if (maxCount && mockMetricsSamples.length > maxCount) {
        const sorted = [...mockMetricsSamples].sort(
          (a, b) => new Date(a.sampledAt).getTime() - new Date(b.sampledAt).getTime()
        );
        toDelete = sorted.slice(0, mockMetricsSamples.length - maxCount);
      }
      const idsToDelete = new Set(toDelete.map((s) => s.id));
      mockMetricsSamples = mockMetricsSamples.filter((s) => !idsToDelete.has(s.id));
      return toDelete.length;
    },

    async insertAuditEvent(data) {
      const now = new Date().toISOString();
      const created: AuditEvent = {
        id: nextId(),
        eventType: data.eventType,
        actorUserId: data.actorUserId ?? null,
        action: data.action ?? null,
        details: data.details ?? null,
        ipAddress: data.ipAddress ?? null,
        createdAt: now
      };
      mockAuditEvents.push(created);
      return { ...created };
    },

    async listAuditEvents(limit) {
      let list = mockAuditEvents.map((e) => ({ ...e }));
      if (limit) {
        list = list.slice(-limit);
      }
      return list;
    },

    async pruneAuditEvents(beforeDate, maxCount) {
      let toDelete = [...mockAuditEvents];
      if (beforeDate) {
        const cutoff = new Date(beforeDate).getTime();
        toDelete = toDelete.filter((e) => new Date(e.createdAt).getTime() < cutoff);
      }
      if (maxCount && mockAuditEvents.length > maxCount) {
        const sorted = [...mockAuditEvents].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        toDelete = sorted.slice(0, mockAuditEvents.length - maxCount);
      }
      const idsToDelete = new Set(toDelete.map((e) => e.id));
      mockAuditEvents = mockAuditEvents.filter((e) => !idsToDelete.has(e.id));
      return toDelete.length;
    },

    async getUiPreference(userId, key) {
      const found = mockUiPreferences.find((p) => p.userId === userId && p.key === key);
      return found ? { ...found } : null;
    },

    async setUiPreference(userId, key, valueJson) {
      const existing = mockUiPreferences.find((p) => p.userId === userId && p.key === key);
      const now = new Date().toISOString();
      if (existing) {
        existing.valueJson = valueJson;
        existing.updatedAt = now;
        return { ...existing };
      }
      const created: UiPreference = { id: nextId(), userId, key, valueJson, updatedAt: now };
      mockUiPreferences.push(created);
      return { ...created };
    },

    async listUiPreferences(userId) {
      return mockUiPreferences.filter((p) => p.userId === userId).map((p) => ({ ...p }));
    }
  };
}

export function getManagerStoreClient(): ManagerStoreClient {
  if (process.env.PYLON_STORE_MOCK === 'true') {
    return createMockManagerStoreClient();
  }
  return createManagerStoreClient();
}

// Test accessors for mock state
export function getMockSettings(): ManagerSetting[] {
  return [...mockSettings];
}

export function getMockSavedVmConfigs(): SavedVmConfig[] {
  return [...mockSavedVmConfigs];
}

export function getMockTomlSnapshots(): TomlSnapshot[] {
  return [...mockTomlSnapshots];
}

export function getMockMetricsSamples(): MetricsSample[] {
  return [...mockMetricsSamples];
}

export function getMockAuditEvents(): AuditEvent[] {
  return [...mockAuditEvents];
}

export function getMockUiPreferences(): UiPreference[] {
  return [...mockUiPreferences];
}
