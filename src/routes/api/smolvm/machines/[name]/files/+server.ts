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
