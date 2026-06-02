import { requireSmolVmAdmin } from '$lib/server/smolvm-api';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) =>
  requireSmolVmAdmin({ locals }, (client) => client.getMachine(params.name));

export const DELETE: RequestHandler = async ({ locals, params }) =>
  requireSmolVmAdmin({ locals }, (client) => client.deleteMachine(params.name));
