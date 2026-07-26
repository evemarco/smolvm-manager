import { auditVmAction, type VmAuditStore } from '$lib/server/audit-vm';
import { requireSmolVmAdmin } from '$lib/server/smolvm-api';
import type { SmolVmClient } from '$lib/server/smolvm-client';
import { validateVmConfig, configToCreateRequest, type VmConfig } from '$lib/server/vm-config';
import type { RequestHandler } from './$types';

export type CreateRouteDeps = {
  client?: SmolVmClient;
  auditStore?: VmAuditStore;
};

export const POST = async (
  event: Parameters<RequestHandler>[0],
  deps?: CreateRouteDeps
): Promise<Response> => {
  const { locals, request, getClientAddress } = event;
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
  const admin = locals.admin;
  return requireSmolVmAdmin({ locals, client: deps?.client }, async (client) => {
    const result = await client.createMachine(createReq);
    if (admin) {
      await auditVmAction({
        action: 'vm.create',
        machineName: config.name,
        actorUserId: admin.id,
        request,
        getClientAddress,
        store: deps?.auditStore
      });
    }
    return result;
  });
};
