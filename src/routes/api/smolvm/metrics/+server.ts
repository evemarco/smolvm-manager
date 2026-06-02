import { smolVmErrorResponse, unauthorizedSmolVmResponse } from '$lib/server/smolvm-api';
import { getSmolVmClient } from '$lib/server/smolvm-client';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.admin) {
    return unauthorizedSmolVmResponse();
  }

  try {
    const metrics = await getSmolVmClient().getMetrics();
    return new Response(metrics, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  } catch (error) {
    return smolVmErrorResponse(error);
  }
};
