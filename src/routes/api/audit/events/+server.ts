import { json } from '@sveltejs/kit';
import { getManagerStoreClient } from '$lib/server/manager-store-client';
import type { AuditEvent } from '$lib/server/manager-store-client';
import type { RequestHandler } from './$types';

export type AuditEventsRouteDeps = {
  store?: {
    listAuditEvents: (limit?: number) => Promise<AuditEvent[]>;
  };
};

export const GET = async (
  event: Parameters<RequestHandler>[0],
  deps?: AuditEventsRouteDeps
): Promise<Response> => {
  const { locals, url } = event;
  if (!locals.admin) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(Math.max(Number(limitParam), 1), 500) : 50;

  const store = deps?.store ?? getManagerStoreClient();

  try {
    const events = await store.listAuditEvents(limit);
    events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return json({ events });
  } catch {
    return json(
      { error: 'STORE_UNAVAILABLE', message: 'Audit events are temporarily unavailable.' },
      { status: 503 }
    );
  }
};
