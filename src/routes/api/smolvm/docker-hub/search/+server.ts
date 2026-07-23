import { json } from '@sveltejs/kit';
import {
  createDockerHubClient,
  getDockerHubJwt,
  invalidateDockerHubJwt,
  normalizeDockerHubError,
  resolveDockerHubCredentials
} from '$lib/server/docker-hub';
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
  const officialOnly = url.searchParams.get('official') === '1' || url.searchParams.get('official') === 'true';

  try {
    const credentials = await resolveDockerHubCredentials();
    const token =
      credentials?.kind === 'jwt'
        ? await getDockerHubJwt('https://hub.docker.com', credentials.username, credentials.pat)
        : credentials?.token;
    const client = createDockerHubClient({ token });
    try {
      const result = await client.searchRepositories(query, page, pageSize, officialOnly);
      return json({ ...result, authenticated: Boolean(token) });
    } catch (err) {
      if (credentials?.kind === 'jwt') invalidateDockerHubJwt();
      throw err;
    }
  } catch (err) {
    const normalized = normalizeDockerHubError(err);
    return json(normalized, { status: normalized.status });
  }
};
