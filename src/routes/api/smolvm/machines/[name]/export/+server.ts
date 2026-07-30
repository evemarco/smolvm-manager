import { auditVmAction, type VmAuditStore } from '$lib/server/audit-vm';
import { requireSmolVmAdmin, unauthorizedSmolVmResponse } from '$lib/server/smolvm-api';
import type { SmolVmClient } from '$lib/server/smolvm-client';
import type { RequestHandler } from './$types';

export type ExportRouteDeps = {
  client?: SmolVmClient;
  auditStore?: VmAuditStore;
};

export const POST = async (
  event: Parameters<RequestHandler>[0],
  deps?: ExportRouteDeps
): Promise<Response> => {
  const { locals, params, request, getClientAddress } = event;
  const admin = locals.admin;
  if (!admin) return unauthorizedSmolVmResponse();
  const body = await request.json();

  return requireSmolVmAdmin({ locals, client: deps?.client }, async (client) => {
    const result = await client.exportMachine(params.name, body);
    if (admin) {
      await auditVmAction({
        action: 'vm.export',
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
