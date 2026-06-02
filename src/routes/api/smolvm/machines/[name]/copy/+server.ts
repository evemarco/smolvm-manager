import { requireSmolVmAdmin } from '$lib/server/smolvm-api';
import {
  validateVmConfig,
  configForCopy,
  configToCreateRequest,
  machineResponseToConfig
} from '$lib/server/vm-config';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  const body = await request.json();
  const newName: string = body.newName ?? `${params.name}-copy`;

  return requireSmolVmAdmin({ locals }, async (client) => {
    const sourceMachine = await client.getMachine(params.name);
    const sourceConfig = machineResponseToConfig(sourceMachine as Record<string, unknown>);
    const copyConfig = configForCopy(sourceConfig, newName);

    const validation = validateVmConfig(copyConfig);
    if (!validation.valid) {
      return new Response(
        JSON.stringify({ error: 'Validation failed', details: validation.errors }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const createReq = configToCreateRequest(copyConfig);
    return client.createMachine(createReq);
  });
};
