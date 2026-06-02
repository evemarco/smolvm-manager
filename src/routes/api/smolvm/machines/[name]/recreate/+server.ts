import { requireSmolVmAdmin } from '$lib/server/smolvm-api';
import { validateVmConfig, configToCreateRequest } from '$lib/server/vm-config';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const body = await request.json();
  const config = body.config ?? body;

  const validation = validateVmConfig(config);
  if (!validation.valid) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', details: validation.errors }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return requireSmolVmAdmin({ locals }, async (client) => {
    await client.deleteMachine(params.name);
    const createReq = configToCreateRequest(config);
    createReq.name = params.name;
    return client.createMachine(createReq);
  });
};
