import { requireSmolVmAdmin } from '$lib/server/smolvm-api';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals }) =>
  requireSmolVmAdmin({ locals }, (client) => client.drainNode());
