import { requireSmolVmAdmin } from '$lib/server/smolvm-api';
import { validateVmConfig, configForCopy, machineResponseToConfig } from '$lib/server/vm-config';
import type { SmolVmCreateMachineBody } from '$lib/server/smolvm-client';
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

    const createBody: SmolVmCreateMachineBody = {
      name: copyConfig.name,
      ...(copyConfig.image
        ? { image: copyConfig.tag ? `${copyConfig.image}:${copyConfig.tag}` : copyConfig.image }
        : {}),
      ...(copyConfig.from ? { from: copyConfig.from } : {}),
      ...(copyConfig.cpus !== undefined ? { cpus: copyConfig.cpus } : {}),
      ...(copyConfig.memory !== undefined ? { memoryMb: copyConfig.memory } : {}),
      ...(copyConfig.storage !== undefined ? { storageGb: copyConfig.storage } : {}),
      ...(copyConfig.overlay !== undefined ? { overlayGb: copyConfig.overlay } : {}),
      ...(copyConfig.net !== undefined ? { net: copyConfig.net } : {}),
      ...(copyConfig.gpu !== undefined ? { gpu: copyConfig.gpu } : {}),
      ...(copyConfig.gpuVram !== undefined ? { gpuVramMb: copyConfig.gpuVram } : {}),
      ...(copyConfig.ports && copyConfig.ports.length > 0 ? { ports: copyConfig.ports } : {}),
      ...(copyConfig.volumes && copyConfig.volumes.length > 0
        ? {
            mounts: copyConfig.volumes.map((v) => ({
              source: v.host,
              target: v.guest,
              ...(v.readOnly ? { readonly: true } : {})
            }))
          }
        : {}),
      ...(copyConfig.env && Object.keys(copyConfig.env).length > 0 ? { env: copyConfig.env } : {}),
      ...(copyConfig.workdir ? { workdir: copyConfig.workdir } : {}),
      ...(copyConfig.init && copyConfig.init.length > 0 ? { init: copyConfig.init } : {}),
      ...(copyConfig.sshAgent !== undefined ? { sshAgent: copyConfig.sshAgent } : {}),
      ...(copyConfig.allowHosts && copyConfig.allowHosts.length > 0
        ? { allowHosts: copyConfig.allowHosts }
        : {}),
      ...(copyConfig.allowCidrs && copyConfig.allowCidrs.length > 0
        ? { allowCidrs: copyConfig.allowCidrs }
        : {}),
      ...(copyConfig.entrypoint ? { entrypoint: copyConfig.entrypoint } : {}),
      ...(copyConfig.cmd ? { cmd: copyConfig.cmd } : {})
    };
    return client.createMachine(createBody);
  });
};
