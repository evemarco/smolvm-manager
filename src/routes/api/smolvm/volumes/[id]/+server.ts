import { requireSmolVmAdmin } from '$lib/server/smolvm-api';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ locals, params }) =>
  requireSmolVmAdmin({ locals }, (client) => client.deleteVolume(params.id));
