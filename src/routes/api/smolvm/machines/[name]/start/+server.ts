import { auditVmAction, type VmAuditStore } from '$lib/server/audit-vm';
import { requireSmolVmAdmin } from '$lib/server/smolvm-api';
import type { SmolVmClient, SmolVmStartMachineOptions } from '$lib/server/smolvm-client';
import type { RequestHandler } from './$types';

export type StartRouteDeps = {
  client?: SmolVmClient;
  auditStore?: VmAuditStore;
};

export const POST = async (
  event: Parameters<RequestHandler>[0],
  deps?: StartRouteDeps
): Promise<Response> => {
  const { locals, params, request, getClientAddress } = event;
  const admin = locals.admin;
  const body = await request.json().catch(() => undefined);
  const options: SmolVmStartMachineOptions = {};
  if (body?.forkable === true) options.forkable = true;
  const auth = body?.registryAuth;
  if (auth && typeof auth.username === 'string' && typeof auth.password === 'string') {
    options.registryAuth = { username: auth.username, password: auth.password };
  }
  return requireSmolVmAdmin({ locals, client: deps?.client }, async (client) => {
    const result = await client.startMachine(params.name, options);
    if (admin) {
      await auditVmAction({
        action: 'vm.start',
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
