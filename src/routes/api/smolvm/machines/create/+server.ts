import { requireSmolVmAdmin } from '$lib/server/smolvm-api';
import { validateVmConfig, type VmConfig } from '$lib/server/vm-config';
import type { SmolVmCreateMachineBody } from '$lib/server/smolvm-client';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
  const body: SmolVmCreateMachineBody = await request.json();

  const validation = validateVmConfig(body as unknown as VmConfig);
  if (!validation.valid) {
    return new Response(
      JSON.stringify({ error: 'Validation failed', details: validation.errors }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  return requireSmolVmAdmin({ locals }, (client) => client.createMachine(body));
};
