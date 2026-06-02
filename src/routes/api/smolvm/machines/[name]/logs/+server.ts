import { createLogsSseResponse } from '$lib/server/smolvm-streaming';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, request, url }) =>
  createLogsSseResponse({ locals, params, request, url });
