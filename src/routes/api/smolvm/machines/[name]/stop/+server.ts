import { auditVmAction, type VmAuditStore } from '$lib/server/audit-vm';
import { requireSmolVmAdmin } from '$lib/server/smolvm-api';
import type { SmolVmClient } from '$lib/server/smolvm-client';
import type { RequestHandler } from './$types';

export type StopRouteDeps = {
  client?: SmolVmClient;
  auditStore?: VmAuditStore;
};

export const POST = async (
  event: Parameters<RequestHandler>[0],
  deps?: StopRouteDeps
): Promise<Response> => {
  const { locals, params, request, getClientAddress } = event;
  const admin = locals.admin;
  return requireSmolVmAdmin({ locals, client: deps?.client }, async (client) => {
    const result = await client.stopMachine(params.name);
    if (admin) {
      await auditVmAction({
        action: 'vm.stop',
        machineName: params.name,
        actorUserId: admin.id,
        request,
        getClientAddress,
        store: deps?.auditStore
      });
    }
    return result;
  });
};
