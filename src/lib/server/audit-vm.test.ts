import { describe, expect, test } from 'bun:test';
import type { VmAuditStore } from '$lib/server/audit-vm';
import { createServiceAuthContext } from '$lib/server/manager-store-client';
import * as createRoute from '../../routes/api/smolvm/machines/create/+server';
import * as machineRoute from '../../routes/api/smolvm/machines/[name]/+server';
import * as startRoute from '../../routes/api/smolvm/machines/[name]/start/+server';
import * as stopRoute from '../../routes/api/smolvm/machines/[name]/stop/+server';

type VmAction = 'vm.start' | 'vm.create' | 'vm.stop' | 'vm.delete';

type AuditInsert = {
  eventType: string;
  actorUserId?: string;
  action?: string;
  details?: string;
  ipAddress?: string;
};

const admin = { id: 'admin-1', email: 'admin@example.com', name: null };
const machineName = 'vm-alpha';
const ipAddress = '203.0.113.9';

function createStore(): VmAuditStore & { inserted: AuditInsert[]; authContexts: unknown[] } {
  const inserted: AuditInsert[] = [];
  const authContexts: unknown[] = [];

  return {
    inserted,
    authContexts,
    async insertAuditEvent(entry: AuditInsert, authContext: unknown) {
      inserted.push(entry);
      authContexts.push(authContext);
      return { id: `evt-${inserted.length}` };
    }
  };
}

function createClient(failingAction?: VmAction) {
  const failWhenSelected = (action: VmAction) => {
    if (failingAction === action) {
      throw new Error(`SmolVM failed to ${action}`);
    }
  };

  return {
    async startMachine(name: string) {
      failWhenSelected('vm.start');
      return { name, action: 'started' };
    },
    async createMachine(body: unknown) {
      failWhenSelected('vm.create');
      return { name: machineName, request: body };
    },
    async stopMachine(name: string) {
      failWhenSelected('vm.stop');
      return { name, action: 'stopped' };
    },
    async deleteMachine(name: string) {
      failWhenSelected('vm.delete');
      return { name, action: 'deleted' };
    }
  };
}

function request(method: 'POST' | 'DELETE', body?: unknown): Request {
  return new Request(`http://local/api/smolvm/machines/${machineName}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `${ipAddress}, 10.0.0.2`
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

function buildEvent(action: VmAction) {
  return {
    locals: { admin },
    params: { name: machineName },
    request: request(
      action === 'vm.delete' ? 'DELETE' : 'POST',
      action === 'vm.create'
        ? { name: machineName, image: 'alpine', cpus: 1, memory: 64 }
        : undefined
    ),
    getClientAddress: () => ipAddress
  };
}

async function invoke(action: VmAction, failingAction?: VmAction) {
  const store = createStore();
  const client = createClient(failingAction);
  const event = buildEvent(action);
  const deps = { client: client as never, auditStore: store };

  switch (action) {
    case 'vm.start':
      return { store, response: await startRoute.POST(event as never, deps) };
    case 'vm.create':
      return { store, response: await createRoute.POST(event as never, deps) };
    case 'vm.stop':
      return { store, response: await stopRoute.POST(event as never, deps) };
    case 'vm.delete':
      return { store, response: await machineRoute.DELETE(event as never, deps) };
  }
}

describe('VM lifecycle audit events', () => {
  for (const action of ['vm.start', 'vm.create', 'vm.stop', 'vm.delete'] as const) {
    test(`audits ${action} exactly once after the SmolVM action succeeds`, async () => {
      // Given
      const { store, response } = await invoke(action);

      // Then
      expect(response.status).toBe(200);
      expect(store.inserted[0]?.action).toBe(action);
      expect(store.inserted).toHaveLength(1);
      expect(store.inserted[0]).toEqual({
        eventType: 'vm.lifecycle',
        actorUserId: admin.id,
        action,
        details: JSON.stringify({ machineName }),
        ipAddress
      });
      expect(store.authContexts).toEqual([createServiceAuthContext()]);
    });

    test(`does not audit ${action} when the SmolVM action fails`, async () => {
      // When
      const { store, response } = await invoke(action, action);

      // Then
      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(store.inserted).toHaveLength(0);
    });

    test(`still returns success for ${action} when audit persistence fails`, async () => {
      // Given
      const store = createStore();
      store.insertAuditEvent = async () => {
        throw new Error('store unavailable');
      };
      const client = createClient();
      const event = buildEvent(action);
      const deps = { client: client as never, auditStore: store };

      // When
      const response = await (action === 'vm.start'
        ? startRoute.POST(event as never, deps)
        : action === 'vm.create'
          ? createRoute.POST(event as never, deps)
          : action === 'vm.stop'
            ? stopRoute.POST(event as never, deps)
            : machineRoute.DELETE(event as never, deps));

      // Then: the completed SmolVM action is not reported as failed
      expect(response.status).toBe(200);
    });
  }
});
