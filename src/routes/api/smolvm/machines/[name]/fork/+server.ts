import { auditVmAction, type VmAuditStore } from '$lib/server/audit-vm';
import { requireSmolVmAdmin, smolVmJson, unauthorizedSmolVmResponse } from '$lib/server/smolvm-api';
import type { SmolVmClient } from '$lib/server/smolvm-client';
import type { RequestHandler } from './$types';

export type ForkRouteDeps = {
  client?: SmolVmClient;
  auditStore?: VmAuditStore;
};

export const POST = async (
  event: Parameters<RequestHandler>[0],
  deps?: ForkRouteDeps
): Promise<Response> => {
  const { locals, params, request, getClientAddress } = event;
  const admin = locals.admin;
  if (!admin) return unauthorizedSmolVmResponse();
  const body = await request.json();
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!name) {
    return smolVmJson(
      { error: 'Fork requires a new machine name.', code: 'SMOLVM_FORK_NAME_REQUIRED' },
      { status: 400 }
    );
  }

  return requireSmolVmAdmin({ locals, client: deps?.client }, async (client) => {
    const result = await client.forkMachine(params.name, body);
    if (admin) {
      await auditVmAction({
        action: 'vm.fork',
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
