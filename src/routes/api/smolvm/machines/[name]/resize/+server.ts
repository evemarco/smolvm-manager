import { requireSmolVmAdmin, smolVmJson, unauthorizedSmolVmResponse } from '$lib/server/smolvm-api';
import type { SmolVmResizeRequest } from '$lib/server/smolvm-client';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.admin) return unauthorizedSmolVmResponse();
  const body = await request.json();
  const resize: SmolVmResizeRequest = {};
  if (typeof body?.storageGb === 'number') {
    if (body.storageGb <= 0) {
      return smolVmJson(
        { error: 'storageGb must be a positive number.', code: 'SMOLVM_RESIZE_INVALID' },
        { status: 400 }
      );
    }
    resize.storageGb = body.storageGb;
  }
  if (typeof body?.overlayGb === 'number') {
    if (body.overlayGb <= 0) {
      return smolVmJson(
        { error: 'overlayGb must be a positive number.', code: 'SMOLVM_RESIZE_INVALID' },
        { status: 400 }
      );
    }
    resize.overlayGb = body.overlayGb;
  }

  return requireSmolVmAdmin({ locals }, (client) => client.resizeMachine(params.name, resize));
};
