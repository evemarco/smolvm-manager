import { error } from '@sveltejs/kit';
import { createManagerHealth } from '$lib/server/manager-health';
import { smolVmDiagnostics } from '$lib/server/smolvm-diagnostics';
import { getSmolVmClient } from '$lib/server/smolvm-client';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.admin) error(401, 'Unauthorized');

  const client = getSmolVmClient();
  const readyz = await client
    .getReadyz()
    .then((r) => ({ status: r.status }))
    .catch(() => null);

  return {
    diagnostics: smolVmDiagnostics.snapshot().toReversed(),
    refreshedAt: new Date().toISOString(),
    health: await createManagerHealth(client),
    readyz
  };
};
