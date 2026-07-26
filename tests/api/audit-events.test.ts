import { beforeEach, describe, expect, test } from 'bun:test';
import type { AuditEvent } from '$lib/server/manager-store-client';
import { GET } from '../../src/routes/api/audit/events/+server';

const admin = { id: 'admin-1', email: 'admin@example.com', name: null };

const SAMPLE_EVENTS: AuditEvent[] = [
  {
    id: 'evt-1',
    eventType: 'vm.lifecycle',
    actorUserId: 'admin-1',
    action: 'vm.start',
    details: JSON.stringify({ machineName: 'web-01' }),
    ipAddress: '10.0.0.5',
    createdAt: '2026-07-25T08:00:00.000Z'
  },
  {
    id: 'evt-2',
    eventType: 'auth',
    actorUserId: 'admin-1',
    action: 'login',
    details: JSON.stringify({ method: 'password' }),
    ipAddress: '10.0.0.5',
    createdAt: '2026-07-25T09:00:00.000Z'
  },
  {
    id: 'evt-3',
    eventType: 'terminal',
    actorUserId: 'admin-1',
    action: 'terminal.open',
    details: JSON.stringify({ machineName: 'db-01' }),
    ipAddress: '10.0.0.5',
    createdAt: '2026-07-25T10:00:00.000Z'
  }
];

let listCalls: { limit?: number }[] = [];
let mockEvents: AuditEvent[] = [];

function fakeStore() {
  return {
    listAuditEvents: async (limit?: number) => {
      listCalls.push({ limit });
      if (limit) return mockEvents.slice(-limit);
      return [...mockEvents];
    }
  };
}

beforeEach(() => {
  listCalls = [];
  mockEvents = [...SAMPLE_EVENTS];
});

function adminLocals() {
  return { admin };
}

function anonLocals() {
  return {};
}

function getEvents(url: string, locals: unknown, deps?: { store: ReturnType<typeof fakeStore> }) {
  return GET(
    {
      locals,
      url: new URL(url)
    } as never,
    deps
  );
}

describe('GET /api/audit/events', () => {
  test('returns 401 when locals.admin is missing', async () => {
    const response = await getEvents('http://local/api/audit/events', anonLocals());

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorized');
  });

  test('default limit is 50 when no limit param provided', async () => {
    const response = await getEvents('http://local/api/audit/events', adminLocals(), {
      store: fakeStore()
    });

    expect(response.status).toBe(200);
    expect(listCalls[0].limit).toBe(50);
  });

  test('clamps limit to max 500 when limit exceeds 500', async () => {
    const response = await getEvents('http://local/api/audit/events?limit=1000', adminLocals(), {
      store: fakeStore()
    });

    expect(response.status).toBe(200);
    expect(listCalls[0].limit).toBe(500);
  });

  test('clamps limit to min 1 when limit is negative or zero', async () => {
    const response = await getEvents('http://local/api/audit/events?limit=-5', adminLocals(), {
      store: fakeStore()
    });

    expect(response.status).toBe(200);
    expect(listCalls[0].limit).toBe(1);
  });

  test('returns events sorted newest-first', async () => {
    const response = await getEvents('http://local/api/audit/events', adminLocals(), {
      store: fakeStore()
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.events).toHaveLength(3);
    expect(body.events[0].id).toBe('evt-3');
    expect(body.events[1].id).toBe('evt-2');
    expect(body.events[2].id).toBe('evt-1');
  });

  test('respects custom limit values smaller than total event count', async () => {
    const response = await getEvents('http://local/api/audit/events?limit=2', adminLocals(), {
      store: fakeStore()
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.events).toHaveLength(2);
    expect(body.events[0].id).toBe('evt-3');
    expect(body.events[1].id).toBe('evt-2');
  });
});
