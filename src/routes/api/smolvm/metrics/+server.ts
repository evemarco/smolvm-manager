import { json } from '@sveltejs/kit';
import { getLiveSnapshot } from '$lib/server/metrics-sampler';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.admin) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const snapshot = await getLiveSnapshot();
    if (!snapshot) {
      return json(
        { error: 'METRICS_UNAVAILABLE', message: 'SmolVM metrics are currently unavailable.' },
        { status: 503 }
      );
    }
    return json(snapshot);
  } catch (error) {
    const { normalizeSmolVmError } = await import('$lib/server/smolvm-client');
    const normalized = normalizeSmolVmError(error);
    return json(normalized, { status: normalized.status });
  }
};
