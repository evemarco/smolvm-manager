import { smolVmErrorResponse, smolVmJson, unauthorizedSmolVmResponse } from '$lib/server/smolvm-api';
import { validateVmConfig, type VmConfig } from '$lib/server/vm-config';
import {
  getSmolVmClient,
  normalizeSmolVmError,
  type SmolVmClient
} from '$lib/server/smolvm-client';
import {
  buildMachineUpdatePlan,
  runSmolVmMachineUpdate,
  type SmolVmMachineUpdateRunner
} from '$lib/server/smolvm-machine-update';
import type { RequestHandler } from './$types';

export type MachineUpdateRouteDeps = {
  readonly client?: SmolVmClient;
  readonly runner?: SmolVmMachineUpdateRunner;
};

export const PATCH = async (
  event: Parameters<RequestHandler>[0],
  deps?: MachineUpdateRouteDeps
): Promise<Response> => {
  const { locals, params, request } = event;
  if (!locals.admin) return unauthorizedSmolVmResponse();

  const body = await request.json();
  const config: VmConfig = body.config ?? body;
  const validation = validateVmConfig({ ...config, name: 'update-target' });
  if (!validation.valid) {
    return smolVmJson(
      { error: 'Validation failed', details: validation.errors },
      { status: 400 }
    );
  }

  const client = deps?.client ?? getSmolVmClient();
  try {
    const machine = await client.getMachine(params.name);
    const plan = buildMachineUpdatePlan(machine, config);
    if (plan.recreateRequired.length > 0 || plan.unsupportedLiveUpdate.length > 0) {
      return smolVmJson(
        {
          available: false,
          feature: 'machineUpdate',
          code: 'SMOLVM_RECREATE_REQUIRED',
          machine: params.name,
          message:
            'These configuration fields require VM recreation through the recreate endpoint.',
          fields: [...plan.recreateRequired, ...plan.unsupportedLiveUpdate].map((diff) => diff.field),
          recreateEndpoint: `/api/smolvm/machines/${encodeURIComponent(params.name)}/recreate`
        },
        { status: 409 }
      );
    }

    const updateRequired = plan.command.length > 5;
    const restartRequired =
      updateRequired && (machine.state === 'running' || machine.status === 'running');
    if (!updateRequired) {
      return smolVmJson({ ...machine, restartPerformed: false });
    }

    if (restartRequired) await client.stopMachine(params.name);

    try {
      await (deps?.runner ?? runSmolVmMachineUpdate)(plan.command);
    } catch (error) {
      if (!restartRequired) throw error;
      const normalized = normalizeSmolVmError(error);
      return smolVmJson(
        {
          ...normalized,
          message: `${normalized.message} The machine remains stopped.`,
          stage: 'update',
          machineState: 'stopped',
          restartPerformed: false
        },
        { status: normalized.status }
      );
    }

    if (restartRequired) {
      try {
        await client.startMachine(params.name);
      } catch (error) {
        const normalized = normalizeSmolVmError(error);
        return smolVmJson(
          {
            ...normalized,
            message: `Configuration saved, but the machine could not restart: ${normalized.message}`,
            stage: 'restart',
            configUpdated: true,
            machineState: 'stopped',
            restartPerformed: false
          },
          { status: normalized.status }
        );
      }
    }

    return smolVmJson({ ...(await client.getMachine(params.name)), restartPerformed: restartRequired });
  } catch (error) {
    return smolVmErrorResponse(error);
  }
};
