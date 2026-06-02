import { requireSmolVmAdmin } from '$lib/server/smolvm-api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params }) =>
  requireSmolVmAdmin({ locals }, (client) => client.stopMachine(params.name));
