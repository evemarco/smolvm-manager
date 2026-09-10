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
  // SmolVM's HTTP create API treats the caller as untrusted and rejects every
  // non-empty SecretRef map (host env/file reads are TrustedLocal-only). Do
  // not forward a payload that can only fail deep in SmolVM, and never turn
  // these refs into inline plaintext. Configure them locally with the CLI.
  if (config.secrets && config.secrets.length > 0) {
    return new Response(
      JSON.stringify({
        error: 'Secrets require local CLI configuration',
        code: 'SMOLVM_SECRETS_CLI_ONLY',
        message:
          'Create the machine with smolvm machine create --secret-env/--secret-file; the HTTP API cannot resolve host secret refs.'
      }),
      { status: 409, headers: { 'Content-Type': 'application/json' } }
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
