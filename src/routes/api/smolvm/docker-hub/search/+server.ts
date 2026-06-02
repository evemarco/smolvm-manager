import { json } from '@sveltejs/kit';
import { getDockerHubClient, normalizeDockerHubError } from '$lib/server/docker-hub';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.admin) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const query = url.searchParams.get('q')?.trim() ?? '';
  if (!query) {
    return json({ error: 'Query parameter "q" is required.' }, { status: 400 });
  }

  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const pageSize = Math.max(1, parseInt(url.searchParams.get('page_size') ?? '25', 10) || 25);

  try {
    const client = getDockerHubClient();
    const result = await client.searchRepositories(query, page, pageSize);
    return json(result);
  } catch (err) {
    const normalized = normalizeDockerHubError(err);
    return json(normalized, { status: normalized.status });
  }
};
