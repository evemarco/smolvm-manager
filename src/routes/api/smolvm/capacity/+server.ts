import { json } from '@sveltejs/kit';
import { parseCapacityResponse } from '$lib/server/metrics-parser';
import { getSmolVmClient } from '$lib/server/smolvm-client';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.admin) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const raw = await getSmolVmClient().getCapacity();
    const parsed = parseCapacityResponse(raw);
    if (!parsed) {
      return json(
        { error: 'CAPACITY_UNAVAILABLE', message: 'SmolVM capacity data could not be parsed.' },
        { status: 503 }
      );
    }
    return json(parsed);
  } catch (error) {
    const { normalizeSmolVmError } = await import('$lib/server/smolvm-client');
    const normalized = normalizeSmolVmError(error);
    return json(normalized, { status: normalized.status });
  }
};
