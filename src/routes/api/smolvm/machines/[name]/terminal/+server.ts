import { createTerminalHandshakeResponse } from '$lib/server/smolvm-streaming';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, request, url }) =>
  createTerminalHandshakeResponse({ locals, params, request, url });
