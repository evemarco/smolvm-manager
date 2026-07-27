import { error } from '@sveltejs/kit';
import { createManagerHealth } from '$lib/server/manager-health';
import { smolVmDiagnostics } from '$lib/server/smolvm-diagnostics';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.admin) error(401, 'Unauthorized');

  return {
    diagnostics: smolVmDiagnostics.snapshot().toReversed(),
    refreshedAt: new Date().toISOString(),
    health: await createManagerHealth()
  };
};
