import { getSmolVmClient } from '$lib/server/smolvm-client';
import { placeholderStatus, unauthorizedSmolVmResponse } from '$lib/server/smolvm-api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params }) => {
  if (!locals.admin) return unauthorizedSmolVmResponse();
  return placeholderStatus(getSmolVmClient().getExecPlaceholder(params.name));
};
