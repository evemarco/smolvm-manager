import { json } from '@sveltejs/kit';
import {
  getSmolVmClient,
  normalizeSmolVmError,
  type SmolVmClient,
  type SmolVmErrorJson
} from '$lib/server/smolvm-client';

type ApiContext = {
  locals: App.Locals;
  client?: SmolVmClient;
};

export function smolVmJson(data: unknown, init?: ResponseInit): Response {
  return json(data, init);
}

export function smolVmErrorResponse(error: unknown): Response {
  const normalized: SmolVmErrorJson = normalizeSmolVmError(error);
  return json(normalized, { status: normalized.status });
}

export function unauthorizedSmolVmResponse(): Response {
  return json({ error: 'Unauthorized' }, { status: 401 });
}

export async function requireSmolVmAdmin<T>(
  context: ApiContext,
  handler: (client: SmolVmClient) => Promise<T> | T
): Promise<Response> {
  if (!context.locals.admin) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await handler(context.client ?? getSmolVmClient());
    return smolVmJson(result);
  } catch (error) {
    return smolVmErrorResponse(error);
  }
}

export function placeholderStatus(body: unknown): Response {
  return smolVmJson(body, { status: 501 });
}
