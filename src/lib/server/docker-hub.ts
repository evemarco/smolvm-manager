export const DOCKER_HUB_ERROR_CODES = {
  RATE_LIMITED: 'DOCKER_HUB_RATE_LIMITED',
  REQUEST_FAILED: 'DOCKER_HUB_REQUEST_FAILED',
  BAD_RESPONSE: 'DOCKER_HUB_BAD_RESPONSE',
  UNREACHABLE: 'DOCKER_HUB_UNREACHABLE',
  INVALID_REFERENCE: 'DOCKER_HUB_INVALID_REFERENCE'
} as const;

export type DockerHubErrorCode =
  (typeof DOCKER_HUB_ERROR_CODES)[keyof typeof DOCKER_HUB_ERROR_CODES];

export type DockerHubErrorJson = {
  code: DockerHubErrorCode;
  message: string;
  status: number;
  retryAfter?: number;
  details?: unknown;
};

export class DockerHubError extends Error {
  code: DockerHubErrorCode;
  status: number;
  retryAfter?: number;
  details?: unknown;

  constructor(
    code: DockerHubErrorCode,
    message: string,
    status: number,
    retryAfter?: number,
    details?: unknown
  ) {
    super(message);
    this.name = 'DockerHubError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
    this.details = details;
  }

  toJSON(): DockerHubErrorJson {
    return normalizeDockerHubError(this);
  }
}

export type DockerHubSearchResult = {
  name: string;
  namespace: string;
  repository_type?: string;
  is_official?: boolean;
  description?: string;
  star_count?: number;
  pull_count?: number;
  last_updated?: string;
};

export type DockerHubSearchPage = {
  results: DockerHubSearchResult[];
  page: number;
  pageSize: number;
  totalCount?: number;
  nextPage?: number;
};

export type DockerHubTagImage = {
  architecture: string;
  os?: string;
  digest?: string;
  size?: number;
};

export type DockerHubTag = {
  name: string;
  digest?: string;
  images: DockerHubTagImage[];
  lastUpdated?: string;
  lastPushed?: string;
  size?: number;
};

export type DockerHubTagPage = {
  results: DockerHubTag[];
  page: number;
  pageSize: number;
  totalCount?: number;
  nextPage?: number;
};

export type DockerHubClientOptions = {
  baseUrl?: string;
  token?: string;
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
};

const DEFAULT_BASE_URL = 'https://hub.docker.com';
const MAX_PAGE_SIZE = 100;
const DEFAULT_TIMEOUT_MS = 15000;
const DETAIL_CACHE_TTL_MS = 10 * 60 * 1000;
const DETAIL_CACHE_MAX_ENTRIES = 500;

// Anonymous Docker Hub throttling bites after ~100 calls; enrichment would
// multiply requests by page size without a cache. Dates move slowly, so a
// short TTL absorbs page revisits and repeated searches.
const detailCache = new Map<string, { lastUpdated?: string; expiresAt: number }>();

function readDetailCache(key: string): { lastUpdated?: string } | undefined {
  const entry = detailCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    detailCache.delete(key);
    return undefined;
  }
  return entry;
}

function writeDetailCache(key: string, value: { lastUpdated?: string }): void {
  if (detailCache.size >= DETAIL_CACHE_MAX_ENTRIES) {
    const oldest = detailCache.keys().next().value;
    if (oldest !== undefined) detailCache.delete(oldest);
  }
  detailCache.set(key, { ...value, expiresAt: Date.now() + DETAIL_CACHE_TTL_MS });
}

function getConfiguredToken(): string | undefined {
  return process.env.DOCKER_HUB_TOKEN?.trim() || undefined;
}

export const DOCKER_HUB_TOKEN_SETTING_KEY = 'docker_hub_token';

export type DockerHubCredentials =
  | { kind: 'jwt'; username: string; pat: string }
  | { kind: 'bearer'; token: string };

/**
 * Credential resolution order: the settings-page values stored in Pylon win,
 * the DOCKER_HUB_TOKEN env var is the fallback (direct bearer), and neither
 * means anonymous. Docker Hub PATs are ignored by the web API when presented
 * directly — they must be exchanged for a JWT via /v2/users/login.
 */
export async function resolveDockerHubCredentials(): Promise<DockerHubCredentials | undefined> {
  try {
    const { getManagerStoreClient } = await import('./manager-store-client');
    const setting = await getManagerStoreClient().getSetting(DOCKER_HUB_TOKEN_SETTING_KEY);
    if (setting?.valueJson) {
      const parsed = JSON.parse(setting.valueJson) as { username?: unknown; token?: unknown };
      const token = typeof parsed.token === 'string' ? parsed.token.trim() : '';
      const username = typeof parsed.username === 'string' ? parsed.username.trim() : '';
      if (token && username) return { kind: 'jwt', username, pat: token };
      if (token) return { kind: 'bearer', token };
    }
  } catch {
    // fall through to the env fallback
  }
  const envToken = process.env.DOCKER_HUB_TOKEN?.trim();
  return envToken ? { kind: 'bearer', token: envToken } : undefined;
}

const JWT_CACHE_TTL_MS = 30 * 60 * 1000;
let jwtCache: { username: string; jwt: string; expiresAt: number } | undefined;

export async function getDockerHubJwt(
  baseUrl: string,
  username: string,
  pat: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): Promise<string> {
  if (jwtCache && jwtCache.username === username && jwtCache.expiresAt > Date.now()) {
    return jwtCache.jwt;
  }
  const response = await fetchImpl(new URL('/v2/users/login', baseUrl).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ username, password: pat })
  });
  if (response.status !== 200) {
    throw new DockerHubError(
      DOCKER_HUB_ERROR_CODES.REQUEST_FAILED,
      `Docker Hub login failed (${response.status}) — check the username and access token.`,
      response.status
    );
  }
  const body = (await response.json()) as { token?: unknown };
  if (typeof body.token !== 'string' || !body.token) {
    throw new DockerHubError(
      DOCKER_HUB_ERROR_CODES.BAD_RESPONSE,
      'Docker Hub login returned no token.',
      502
    );
  }
  jwtCache = { username, jwt: body.token, expiresAt: Date.now() + JWT_CACHE_TTL_MS };
  return body.token;
}

export function invalidateDockerHubJwt(): void {
  jwtCache = undefined;
}

/**
 * Kept for backwards compatibility with older callers/tests.
 * Token resolution order: the settings-page value stored in Pylon wins, the
 * DOCKER_HUB_TOKEN env var is the fallback, and neither means anonymous.
 * Store failures degrade to the env var rather than breaking search.
 */
export async function resolveDockerHubToken(): Promise<string | undefined> {
  const credentials = await resolveDockerHubCredentials();
  if (!credentials) return undefined;
  return credentials.kind === 'bearer' ? credentials.token : credentials.pat;
}

function cappedPageSize(size: number): number {
  return Math.max(1, Math.min(size, MAX_PAGE_SIZE));
}

function buildSearchUrl(
  baseUrl: string,
  query: string,
  page: number,
  pageSize: number,
  officialOnly: boolean
): string {
  const url = new URL('/v2/search/repositories/', baseUrl);
  url.searchParams.set('query', query);
  url.searchParams.set('page', String(page));
  url.searchParams.set('page_size', String(cappedPageSize(pageSize)));
  if (officialOnly) url.searchParams.set('is_official', 'true');
  return url.toString();
}

function buildTagsUrl(
  baseUrl: string,
  namespace: string,
  repo: string,
  page: number,
  pageSize: number
): string {
  const url = new URL(
    `/v2/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/tags`,
    baseUrl
  );
  url.searchParams.set('page', String(page));
  url.searchParams.set('page_size', String(cappedPageSize(pageSize)));
  return url.toString();
}

function buildRepositoryUrl(baseUrl: string, namespace: string, repo: string): string {
  return new URL(
    `/v2/repositories/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}`,
    baseUrl
  ).toString();
}

function coerceRepositoryDetail(body: unknown): { lastUpdated?: string } {
  if (!body || typeof body !== 'object') return {};
  const lastUpdated = (body as Record<string, unknown>).last_updated;
  return { lastUpdated: typeof lastUpdated === 'string' ? lastUpdated : undefined };
}

function parseRetryAfter(headers: Headers): number | undefined {
  const raw = headers.get('retry-after');
  if (!raw) return undefined;
  const parsed = parseInt(raw, 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return undefined;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof globalThis.fetch
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new DockerHubError(
        DOCKER_HUB_ERROR_CODES.UNREACHABLE,
        'Docker Hub request timed out.',
        504
      );
    }
    throw new DockerHubError(DOCKER_HUB_ERROR_CODES.UNREACHABLE, 'Docker Hub is unreachable.', 503);
  } finally {
    clearTimeout(timer);
  }
}

async function callDockerHub<T>(
  url: string,
  token: string | undefined,
  timeoutMs: number,
  fetchImpl: typeof globalThis.fetch,
  coerce: (value: unknown) => T
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(url, { headers }, timeoutMs, fetchImpl);
  } catch (error) {
    if (error instanceof DockerHubError) throw error;
    throw new DockerHubError(DOCKER_HUB_ERROR_CODES.UNREACHABLE, 'Docker Hub is unreachable.', 503);
  }

  if (response.status === 429) {
    const retryAfter = parseRetryAfter(response.headers);
    throw new DockerHubError(
      DOCKER_HUB_ERROR_CODES.RATE_LIMITED,
      'Docker Hub rate limit exceeded. Please try again later.',
      429,
      retryAfter
    );
  }

  if (response.status < 200 || response.status >= 300) {
    const text = await response.text().catch(() => '');
    throw new DockerHubError(
      DOCKER_HUB_ERROR_CODES.REQUEST_FAILED,
      `Docker Hub request failed (${response.status}).`,
      response.status || 502,
      undefined,
      text ? { body: text } : undefined
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new DockerHubError(
      DOCKER_HUB_ERROR_CODES.BAD_RESPONSE,
      'Docker Hub returned invalid JSON.',
      502
    );
  }

  return coerce(body);
}

function coerceSearchPage(body: unknown): DockerHubSearchPage {
  if (!body || typeof body !== 'object') {
    throw new DockerHubError(
      DOCKER_HUB_ERROR_CODES.BAD_RESPONSE,
      'Docker Hub search returned an invalid payload.',
      502
    );
  }

  const obj = body as Record<string, unknown>;
  const rawResults = Array.isArray(obj.results) ? obj.results : [];
  const page = typeof obj.page === 'number' ? obj.page : 1;
  const pageSize = typeof obj.page_size === 'number' ? obj.page_size : MAX_PAGE_SIZE;
  const totalCount = typeof obj.count === 'number' ? obj.count : undefined;

  const results: DockerHubSearchResult[] = rawResults.map((item: unknown) => {
    const s = (item ?? {}) as Record<string, unknown>;
    const repoName = typeof s.repo_name === 'string' ? s.repo_name : '';
    const parts = repoName.split('/');
    const namespace = parts.length > 1 ? parts[0] : 'library';
    const name = parts.length > 1 ? parts.slice(1).join('/') : repoName;

    return {
      name,
      namespace,
      repository_type: typeof s.repository_type === 'string' ? s.repository_type : undefined,
      is_official: typeof s.is_official === 'boolean' ? s.is_official : undefined,
      description: typeof s.short_description === 'string' ? s.short_description : undefined,
      star_count: typeof s.star_count === 'number' ? s.star_count : undefined,
      pull_count: typeof s.pull_count === 'number' ? s.pull_count : undefined
    };
  });

  const nextPage = typeof obj.next === 'string' && obj.next ? page + 1 : undefined;

  return { results, page, pageSize, totalCount, nextPage };
}

function coerceTagPage(body: unknown): DockerHubTagPage {
  if (!body || typeof body !== 'object') {
    throw new DockerHubError(
      DOCKER_HUB_ERROR_CODES.BAD_RESPONSE,
      'Docker Hub tags returned an invalid payload.',
      502
    );
  }

  const obj = body as Record<string, unknown>;
  const rawResults = Array.isArray(obj.results) ? obj.results : [];
  const page = typeof obj.page === 'number' ? obj.page : 1;
  const pageSize = typeof obj.page_size === 'number' ? obj.page_size : MAX_PAGE_SIZE;
  const totalCount = typeof obj.count === 'number' ? obj.count : undefined;

  const results: DockerHubTag[] = rawResults.map((item: unknown) => {
    const t = (item ?? {}) as Record<string, unknown>;
    const name = typeof t.name === 'string' ? t.name : '';
    const digest = typeof t.digest === 'string' ? t.digest : undefined;
    const lastUpdated = typeof t.last_updated === 'string' ? t.last_updated : undefined;
    const lastPushed = typeof t.tag_last_pushed === 'string' ? t.tag_last_pushed : undefined;

    const rawImages = Array.isArray(t.images) ? t.images : [];
    const images: DockerHubTagImage[] = rawImages.map((img: unknown) => {
      const i = (img ?? {}) as Record<string, unknown>;
      return {
        architecture: typeof i.architecture === 'string' ? i.architecture : 'unknown',
        os: typeof i.os === 'string' ? i.os : undefined,
        digest: typeof i.digest === 'string' ? i.digest : undefined,
        size: typeof i.size === 'number' ? i.size : undefined
      };
    });

    // Derive overall size from first image if available
    const size =
      images.length > 0 && typeof images[0].size === 'number' ? images[0].size : undefined;

    return { name, digest, images, lastUpdated, lastPushed, size };
  });

  const nextPage = typeof obj.next === 'string' && obj.next ? page + 1 : undefined;

  return { results, page, pageSize, totalCount, nextPage };
}

export type DockerHubClient = {
  searchRepositories(
    query: string,
    page?: number,
    pageSize?: number,
    officialOnly?: boolean
  ): Promise<DockerHubSearchPage>;
  listTags(
    namespace: string,
    repo: string,
    page?: number,
    pageSize?: number
  ): Promise<DockerHubTagPage>;
};

export function createDockerHubClient(options: DockerHubClientOptions = {}): DockerHubClient {
  const baseUrl = options.baseUrl?.trim() || DEFAULT_BASE_URL;
  const token = options.token ?? getConfiguredToken();
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async searchRepositories(query, page = 1, pageSize = 25, officialOnly = false) {
      const url = buildSearchUrl(baseUrl, query, page, pageSize, officialOnly);
      const result = await callDockerHub(url, token, timeoutMs, fetchImpl, coerceSearchPage);
      // The v2 search/tags responses omit the page number; echo the request.
      const paged = {
        ...result,
        page,
        nextPage: result.nextPage === undefined ? undefined : page + 1
      };
      // Search results carry no date; enrich from the per-repository detail
      // endpoint in parallel and drop dates that fail rather than the search.
      const enriched = await Promise.all(
        paged.results.map(async (r) => {
          const cacheKey = `${r.namespace}/${r.name}`;
          const cached = readDetailCache(cacheKey);
          if (cached) {
            return cached.lastUpdated ? { ...r, last_updated: cached.lastUpdated } : r;
          }
          try {
            const detail = await callDockerHub(
              buildRepositoryUrl(baseUrl, r.namespace, r.name),
              token,
              timeoutMs,
              fetchImpl,
              coerceRepositoryDetail
            );
            writeDetailCache(cacheKey, detail);
            return { ...r, last_updated: detail.lastUpdated };
          } catch {
            return r;
          }
        })
      );
      return { ...paged, results: enriched };
    },

    async listTags(namespace, repo, page = 1, pageSize = 25) {
      const url = buildTagsUrl(baseUrl, namespace, repo, page, pageSize);
      const result = await callDockerHub(url, token, timeoutMs, fetchImpl, coerceTagPage);
      return { ...result, page, nextPage: result.nextPage === undefined ? undefined : page + 1 };
    }
  };
}

export function normalizeDockerHubError(error: unknown): DockerHubErrorJson {
  if (error instanceof DockerHubError) {
    const json: DockerHubErrorJson = {
      code: error.code,
      message: error.message,
      status: error.status
    };
    if (error.retryAfter !== undefined) json.retryAfter = error.retryAfter;
    if (error.details !== undefined) json.details = error.details;
    return json;
  }

  if (error instanceof Error) {
    return {
      code: DOCKER_HUB_ERROR_CODES.REQUEST_FAILED,
      message: error.message,
      status: 502
    };
  }

  return {
    code: DOCKER_HUB_ERROR_CODES.REQUEST_FAILED,
    message: 'Docker Hub request failed.',
    status: 502
  };
}

export function getDockerHubClient(): DockerHubClient {
  return createDockerHubClient();
}
