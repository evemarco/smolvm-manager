import { json } from '@sveltejs/kit';
import {
  createDockerHubClient,
  getDockerHubJwt,
  invalidateDockerHubJwt,
  normalizeDockerHubError,
  resolveDockerHubCredentials
} from '$lib/server/docker-hub';
import { isValidImageReference, imageRefToDockerHubParts } from '$lib/server/image-reference';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, url }) => {
  if (!locals.admin) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const imageRef = url.searchParams.get('image')?.trim() ?? '';
  let namespace: string;
  let repo: string;

  if (imageRef) {
    if (!isValidImageReference(imageRef)) {
      return json(
        { error: 'Invalid image reference.', code: 'IMAGE_REF_INVALID_FORMAT' },
        { status: 400 }
      );
    }
    const parts = imageRefToDockerHubParts(imageRef);
    namespace = parts.namespace;
    repo = parts.repository;
  } else {
    namespace = url.searchParams.get('namespace')?.trim() ?? '';
    repo = url.searchParams.get('repo')?.trim() ?? '';
  }

  if (!namespace || !repo) {
    return json(
      { error: 'Parameters "namespace" and "repo" (or valid "image") are required.' },
      { status: 400 }
    );
  }

  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1);
  const pageSize = Math.max(1, parseInt(url.searchParams.get('page_size') ?? '25', 10) || 25);

  try {
    const credentials = await resolveDockerHubCredentials();
    const token =
      credentials?.kind === 'jwt'
        ? await getDockerHubJwt('https://hub.docker.com', credentials.username, credentials.pat)
        : credentials?.token;
    const client = createDockerHubClient({ token });
    try {
      const result = await client.listTags(namespace, repo, page, pageSize);
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
