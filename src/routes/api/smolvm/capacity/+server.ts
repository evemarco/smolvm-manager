import { requireSmolVmAdmin } from '$lib/server/smolvm-api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) =>
  requireSmolVmAdmin({ locals }, (client) => client.getCapacity());
