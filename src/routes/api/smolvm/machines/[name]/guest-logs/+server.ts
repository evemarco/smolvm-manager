import { createGuestLogsSseResponse } from '$lib/server/smolvm-guest-logs';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, request, url }) =>
  createGuestLogsSseResponse({ locals, params, request, url });
