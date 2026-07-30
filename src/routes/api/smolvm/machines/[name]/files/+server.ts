import {
  smolVmJson,
  smolVmErrorResponse,
  unauthorizedSmolVmResponse
} from '$lib/server/smolvm-api';
import { getSmolVmClient } from '$lib/server/smolvm-client';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!locals.admin) return unauthorizedSmolVmResponse();
  const path = url.searchParams.get('path')?.trim();
  if (!path) {
    return smolVmJson(
      { error: 'Query parameter "path" is required.', code: 'SMOLVM_FILE_PATH_REQUIRED' },
      { status: 400 }
    );
  }

  try {
    return smolVmJson(await getSmolVmClient().downloadMachineFile(params.name, path));
  } catch (error) {
    return smolVmErrorResponse(error);
  }
};

export const PUT: RequestHandler = async ({ locals, params, request, url }) => {
  if (!locals.admin) return unauthorizedSmolVmResponse();
  const path = url.searchParams.get('path')?.trim();
  if (!path) {
    return smolVmJson(
      { error: 'Query parameter "path" is required.', code: 'SMOLVM_FILE_PATH_REQUIRED' },
      { status: 400 }
    );
  }
  const body = await request.json();
  if (typeof body?.content !== 'string') {
    return smolVmJson(
      { error: 'Body field "content" is required.', code: 'SMOLVM_FILE_CONTENT_REQUIRED' },
      { status: 400 }
    );
  }

  try {
    return smolVmJson(await getSmolVmClient().uploadMachineFile(params.name, path, body.content));
  } catch (error) {
    return smolVmErrorResponse(error);
  }
};
