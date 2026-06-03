import { requireSmolVmAdmin, unauthorizedSmolVmResponse } from '$lib/server/smolvm-api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.admin) return unauthorizedSmolVmResponse();
  const body = await request.json();
  return requireSmolVmAdmin({ locals }, (client) => client.execMachine(params.name, body));
};
