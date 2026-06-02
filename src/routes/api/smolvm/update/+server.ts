import { getSmolVmClient } from '$lib/server/smolvm-client';
import { placeholderStatus, unauthorizedSmolVmResponse } from '$lib/server/smolvm-api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.admin) return unauthorizedSmolVmResponse();
  return placeholderStatus(getSmolVmClient().getUpdatePlaceholder());
};
