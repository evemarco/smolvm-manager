import { createMachineStreamSseResponse } from '$lib/server/smolvm-machine-stream';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, request }) =>
  createMachineStreamSseResponse({ locals, request });
