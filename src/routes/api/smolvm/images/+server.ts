import {
  smolVmErrorResponse,
  smolVmJson,
  unauthorizedSmolVmResponse
} from '$lib/server/smolvm-api';
import { getSmolVmClient } from '$lib/server/smolvm-client';
import type { RequestHandler } from './$types';

function missingMachineResponse(): Response {
  return smolVmJson(
    {
      available: false,
      feature: 'images',
      code: 'SMOLVM_MACHINE_REQUIRED',
      message: 'SmolVM 0.8.1 exposes image cache operations per machine. Supply ?machine=<name>.'
    },
    { status: 400 }
  );
}

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.admin) return unauthorizedSmolVmResponse();
  const machine = url.searchParams.get('machine')?.trim();
  if (!machine) return missingMachineResponse();

  try {
    return smolVmJson(await getSmolVmClient().listMachineImages(machine));
  } catch (error) {
    return smolVmErrorResponse(error);
  }
};

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.admin) return unauthorizedSmolVmResponse();
  const body = await request.json();
  const machine = typeof body.machine === 'string' ? body.machine.trim() : '';
  if (!machine) return missingMachineResponse();

  try {
    return smolVmJson(await getSmolVmClient().pullMachineImage(machine, body));
  } catch (error) {
    return smolVmErrorResponse(error);
  }
};
