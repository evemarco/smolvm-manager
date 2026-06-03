import { smolVmJson, unauthorizedSmolVmResponse } from '$lib/server/smolvm-api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.admin) return unauthorizedSmolVmResponse();
  return smolVmJson({
    available: false,
    feature: 'managerUpdate',
    code: 'SMOLVM_MANAGER_UPDATE_UNAVAILABLE',
    message:
      'SmolVM 0.8.1 does not expose a server update endpoint. Upgrade the manager and SmolVM through the deployment process.'
  });
};
