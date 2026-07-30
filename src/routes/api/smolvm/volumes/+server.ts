import { requireSmolVmAdmin, smolVmJson, unauthorizedSmolVmResponse } from '$lib/server/smolvm-api';
import type { SmolVmVolumeCreateRequest } from '$lib/server/smolvm-client';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, request }) => {
  if (!locals.admin) return unauthorizedSmolVmResponse();
  const body = await request.json();
  const volume: SmolVmVolumeCreateRequest = { sizeGb: body.sizeGb };
  if (typeof body?.id === 'string') volume.id = body.id;
  if (typeof body?.backend === 'string') volume.backend = body.backend;
  if (typeof volume.sizeGb !== 'number' || volume.sizeGb <= 0) {
    return smolVmJson(
      { error: 'sizeGb must be a positive number.', code: 'SMOLVM_VOLUME_SIZE_INVALID' },
      { status: 400 }
    );
  }

  return requireSmolVmAdmin({ locals }, (client) => client.provisionVolume(volume));
};
