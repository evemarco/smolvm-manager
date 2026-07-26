import { error } from '@sveltejs/kit';
import { smolVmDiagnostics } from '$lib/server/smolvm-diagnostics';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
  if (!locals.admin) error(401, 'Unauthorized');

  return {
    diagnostics: smolVmDiagnostics.snapshot().toReversed(),
    refreshedAt: new Date().toISOString()
  };
};
