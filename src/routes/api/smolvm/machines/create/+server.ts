import { requireSmolVmAdmin } from '$lib/server/smolvm-api';
import { validateVmConfig, configToCreateRequest, type VmConfig } from '$lib/server/vm-config';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
  const body = await request.json();
  const config: VmConfig = body;

  const validation = validateVmConfig(config);
  if (!validation.valid) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', details: validation.errors }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const createReq = configToCreateRequest(config);
  return requireSmolVmAdmin({ locals }, (client) => client.createMachine(createReq));
};
