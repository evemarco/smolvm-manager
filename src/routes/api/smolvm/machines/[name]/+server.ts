import { auditVmAction, type VmAuditStore } from '$lib/server/audit-vm';
import { requireSmolVmAdmin } from '$lib/server/smolvm-api';
import type { SmolVmClient } from '$lib/server/smolvm-client';
import type { RequestHandler } from './$types';

export type MachineRouteDeps = {
  client?: SmolVmClient;
  auditStore?: VmAuditStore;
};

export const GET: RequestHandler = async ({ locals, params }) =>
  requireSmolVmAdmin({ locals }, (client) => client.getMachine(params.name));

export const DELETE = async (
  event: Parameters<RequestHandler>[0],
  deps?: MachineRouteDeps
): Promise<Response> => {
  const { locals, params, request, getClientAddress } = event;
  const admin = locals.admin;
  const query = new URL(request.url).searchParams;
  const force = query.get('force') === 'true';
  const cascade = query.get('cascade') === 'true';
  return requireSmolVmAdmin({ locals, client: deps?.client }, async (client) => {
    const result = await client.deleteMachine(params.name, { force, cascade });
    if (admin) {
      await auditVmAction({
        action: 'vm.delete',
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
