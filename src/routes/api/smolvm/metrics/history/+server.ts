import { json } from '@sveltejs/kit';
import { getManagerStoreClient } from '$lib/server/manager-store-client';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.admin) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const machineName = url.searchParams.get('machine') ?? undefined;
  const limitParam = url.searchParams.get('limit');
  const limit = limitParam ? Math.min(Math.max(Number(limitParam), 1), 2880) : 100;

  const store = getManagerStoreClient();

  try {
    const samples = await store.listMetricsSamples(machineName, limit);
    return json({ samples });
  } catch {
    return json(
      { error: 'STORE_UNAVAILABLE', message: 'Metrics history is temporarily unavailable.' },
      { status: 503 }
    );
  }
};
