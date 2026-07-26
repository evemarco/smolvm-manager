import { createGlobalLogsSseResponse } from '$lib/server/smolvm-global-logs';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, request, url }) =>
  createGlobalLogsSseResponse({ locals, request, url });
