import { smolVmJson, unauthorizedSmolVmResponse } from '$lib/server/smolvm-api';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ locals, params }) => {
  if (!locals.admin) return unauthorizedSmolVmResponse();

  return smolVmJson(
    {
      available: false,
      feature: 'machineUpdate',
      code: 'SMOLVM_RECREATE_REQUIRED',
      machine: params.name,
      message:
        'SmolVM 0.8.1 does not expose a general live machine update API. Use the recreate endpoint for configuration changes.',
      recreateEndpoint: `/api/smolvm/machines/${encodeURIComponent(params.name)}/recreate`
    },
    { status: 409 }
  );
};
