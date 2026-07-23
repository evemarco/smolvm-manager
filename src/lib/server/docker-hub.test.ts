import { expect, test, describe } from 'bun:test';
import {
  DOCKER_HUB_ERROR_CODES,
  DockerHubError,
  createDockerHubClient,
  normalizeDockerHubError
} from './docker-hub';
import {
  IMAGE_REF_ERROR_CODES,
  ImageRefError,
  parseImageReference,
  normalizeImageReference,
  isValidImageReference,
  imageRefToDockerHubParts
} from './image-reference';

// --- Image Reference Tests ---

describe('image-reference', () => {
  test('parses official image without tag', () => {
    const ref = parseImageReference('alpine');
    expect(ref.namespace).toBe('library');
    expect(ref.repository).toBe('alpine');
    expect(ref.tag).toBe('latest');
    expect(ref.fullName).toBe('library/alpine');
    expect(ref.fullNameWithTag).toBe('library/alpine:latest');
  });

  test('parses official image with tag', () => {
    const ref = parseImageReference('alpine:3.18');
    expect(ref.namespace).toBe('library');
    expect(ref.repository).toBe('alpine');
    expect(ref.tag).toBe('3.18');
    expect(ref.fullNameWithTag).toBe('library/alpine:3.18');
  });

  test('parses namespaced image', () => {
    const ref = parseImageReference('myuser/myapp:v1.0');
    expect(ref.namespace).toBe('myuser');
    expect(ref.repository).toBe('myapp');
    expect(ref.tag).toBe('v1.0');
    expect(ref.fullNameWithTag).toBe('myuser/myapp:v1.0');
  });

  test('parses image with registry', () => {
    const ref = parseImageReference('registry.example.com/ns/repo:tag');
    expect(ref.registry).toBe('registry.example.com');
    expect(ref.namespace).toBe('ns');
    expect(ref.repository).toBe('repo');
    expect(ref.tag).toBe('tag');
  });

  test('rejects empty reference', () => {
    expect(() => parseImageReference('')).toThrow(ImageRefError);
    try {
      parseImageReference('');
    } catch (e) {
      expect((e as ImageRefError).code).toBe(IMAGE_REF_ERROR_CODES.EMPTY_NAME);
    }
  });

  test('rejects whitespace', () => {
    expect(() => parseImageReference('alpine latest')).toThrow(ImageRefError);
  });

  test('rejects invalid tag', () => {
    expect(() => parseImageReference('alpine:')).toThrow(ImageRefError);
    expect(() => parseImageReference('alpine:tag!')).toThrow(ImageRefError);
  });

  test('rejects invalid repository name', () => {
    expect(() => parseImageReference('-invalid')).toThrow(ImageRefError);
  });

  test('normalizeImageReference returns full name with tag', () => {
    expect(normalizeImageReference('alpine')).toBe('library/alpine:latest');
    expect(normalizeImageReference('alpine:3.18')).toBe('library/alpine:3.18');
  });

  test('isValidImageReference returns boolean', () => {
    expect(isValidImageReference('alpine')).toBe(true);
    expect(isValidImageReference('alpine:3.18')).toBe(true);
    expect(isValidImageReference('')).toBe(false);
    expect(isValidImageReference('alpine:bad!tag')).toBe(false);
  });

  test('imageRefToDockerHubParts extracts components', () => {
    const parts = imageRefToDockerHubParts('library/nginx:1.25');
    expect(parts.namespace).toBe('library');
    expect(parts.repository).toBe('nginx');
    expect(parts.tag).toBe('1.25');
  });
});

// --- Docker Hub Client Tests ---

function createMockFetch(responses: Array<{ urlMatcher: RegExp; response: Response }>) {
  return async (url: string | URL | Request) => {
    const urlStr =
      typeof url === 'string' ? url : url instanceof Request ? url.url : url.toString();
    for (const r of responses) {
      if (r.urlMatcher.test(urlStr)) {
        return r.response;
      }
    }
    return new Response('Not Found', { status: 404 });
  };
}

describe('docker-hub client', () => {
  test('searchRepositories constructs safe URL and parses response', async () => {
    const mockFetch = createMockFetch([
      {
        urlMatcher: /\/v2\/search\/repositories\//,
        response: new Response(
          JSON.stringify({
            count: 1,
            page: 1,
            page_size: 25,
            next: null,
            results: [
              {
                repo_name: 'alpine',
                short_description: 'A minimal Docker image',
                star_count: 5000,
                pull_count: 1000000,
                is_official: true
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
    ]);

    const client = createDockerHubClient({ fetch: mockFetch as unknown as typeof fetch });
    const page = await client.searchRepositories('alpine');

    expect(page.results).toHaveLength(1);
    expect(page.results[0].name).toBe('alpine');
    expect(page.results[0].namespace).toBe('library');
    expect(page.results[0].is_official).toBe(true);
    expect(page.pageSize).toBe(25);
  });

  test('echoes the requested page when the API omits it', async () => {
    const mockFetch = createMockFetch([
      {
        urlMatcher: /\/v2\/search\/repositories\//,
        response: new Response(JSON.stringify({ count: 5000, results: [], next: 'x' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    ]);

    const client = createDockerHubClient({ fetch: mockFetch as unknown as typeof fetch });
    const page = await client.searchRepositories('tor', 3, 25);

    expect(page.page).toBe(3);
    expect(page.nextPage).toBe(4);
  });

  test('passes is_official when officialOnly is set', async () => {
    let capturedUrl = '';
    const mockFetch = async (url: string | URL | Request) => {
      capturedUrl =
        typeof url === 'string' ? url : url instanceof Request ? url.url : url.toString();
      return new Response(JSON.stringify({ count: 0, results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const client = createDockerHubClient({ fetch: mockFetch as unknown as typeof fetch });
    await client.searchRepositories('nginx', 1, 25, true);

    expect(new URL(capturedUrl).searchParams.get('is_official')).toBe('true');
  });

  test('enriches search results with repository last_updated', async () => {
    const mockFetch = createMockFetch([
      {
        urlMatcher: /\/v2\/search\/repositories\//,
        response: new Response(
          JSON.stringify({
            count: 1,
            results: [{ repo_name: 'leplusorg/tor', short_description: 'Tor image' }]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      },
      {
        urlMatcher: /\/v2\/repositories\/leplusorg\/tor$/,
        response: new Response(JSON.stringify({ last_updated: '2026-07-20T10:00:00Z' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    ]);

    const client = createDockerHubClient({ fetch: mockFetch as unknown as typeof fetch });
    const page = await client.searchRepositories('tor');

    expect(page.results[0].last_updated).toBe('2026-07-20T10:00:00Z');
  });

  test('keeps search results when a detail call fails', async () => {
    const mockFetch = createMockFetch([
      {
        urlMatcher: /\/v2\/search\/repositories\//,
        response: new Response(
          JSON.stringify({
            count: 1,
            results: [{ repo_name: 'failcase/tor', short_description: 'Tor image' }]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
    ]);

    const client = createDockerHubClient({ fetch: mockFetch as unknown as typeof fetch });
    const page = await client.searchRepositories('tor');

    expect(page.results).toHaveLength(1);
    expect(page.results[0].last_updated).toBeUndefined();
  });

  test('listTags constructs safe URL and parses tag metadata', async () => {
    const mockFetch = createMockFetch([
      {
        urlMatcher: /\/v2\/repositories\/library\/alpine\/tags/,
        response: new Response(
          JSON.stringify({
            count: 2,
            page: 1,
            page_size: 25,
            results: [
              {
                name: 'latest',
                digest: 'sha256:abc123',
                last_updated: '2024-01-15T10:30:00Z',
                tag_last_pushed: '2024-01-15T10:30:00Z',
                images: [
                  { architecture: 'amd64', os: 'linux', digest: 'sha256:abc123', size: 1234567 }
                ]
              },
              {
                name: '3.18',
                digest: 'sha256:def456',
                last_updated: '2024-01-10T08:00:00Z',
                tag_last_pushed: '2024-01-10T08:00:00Z',
                images: [
                  { architecture: 'arm64', os: 'linux', digest: 'sha256:def456', size: 987654 }
                ]
              }
            ]
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      }
    ]);

    const client = createDockerHubClient({ fetch: mockFetch as unknown as typeof fetch });
    const page = await client.listTags('library', 'alpine');

    expect(page.results).toHaveLength(2);
    expect(page.results[0].name).toBe('latest');
    expect(page.results[0].digest).toBe('sha256:abc123');
    expect(page.results[0].images[0].architecture).toBe('amd64');
    expect(page.results[0].images[0].os).toBe('linux');
    expect(page.results[0].size).toBe(1234567);
    expect(page.results[1].name).toBe('3.18');
  });

  test('page size is capped at 100', async () => {
    let capturedUrl = '';
    const mockFetch = async (url: string | URL | Request) => {
      capturedUrl =
        typeof url === 'string' ? url : url instanceof Request ? url.url : url.toString();
      return new Response(JSON.stringify({ results: [], page: 1, page_size: 100, count: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const client = createDockerHubClient({ fetch: mockFetch as unknown as typeof fetch });
    await client.searchRepositories('test', 1, 500);

    const url = new URL(capturedUrl);
    expect(url.searchParams.get('page_size')).toBe('100');
  });

  test('handles 429 with Retry-After', async () => {
    const mockFetch = createMockFetch([
      {
        urlMatcher: /.*/,
        response: new Response('Rate limited', {
          status: 429,
          headers: { 'Retry-After': '60' }
        })
      }
    ]);

    const client = createDockerHubClient({ fetch: mockFetch as unknown as typeof fetch });

    try {
      await client.searchRepositories('alpine');
      expect(false).toBe(true); // should not reach here
    } catch (e) {
      expect(e).toBeInstanceOf(DockerHubError);
      const err = e as DockerHubError;
      expect(err.code).toBe(DOCKER_HUB_ERROR_CODES.RATE_LIMITED);
      expect(err.status).toBe(429);
      expect(err.retryAfter).toBe(60);
    }
  });

  test('handles 429 without Retry-After', async () => {
    const mockFetch = createMockFetch([
      {
        urlMatcher: /.*/,
        response: new Response('Rate limited', { status: 429 })
      }
    ]);

    const client = createDockerHubClient({ fetch: mockFetch as unknown as typeof fetch });

    try {
      await client.listTags('library', 'alpine');
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(DockerHubError);
      const err = e as DockerHubError;
      expect(err.code).toBe(DOCKER_HUB_ERROR_CODES.RATE_LIMITED);
      expect(err.retryAfter).toBeUndefined();
    }
  });

  test('handles timeout as unreachable', async () => {
    const mockFetch = async () => {
      const error = new Error('The operation was aborted');
      (error as Error).name = 'AbortError';
      throw error;
    };

    const client = createDockerHubClient({
      fetch: mockFetch as unknown as typeof fetch,
      timeoutMs: 1
    });

    try {
      await client.searchRepositories('alpine');
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(DockerHubError);
      const err = e as DockerHubError;
      expect(err.code).toBe(DOCKER_HUB_ERROR_CODES.UNREACHABLE);
      expect(err.status).toBe(504);
    }
  });

  test('handles network failure as unreachable', async () => {
    const mockFetch = async () => {
      throw new Error('Network error');
    };

    const client = createDockerHubClient({ fetch: mockFetch as unknown as typeof fetch });

    try {
      await client.listTags('library', 'alpine');
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(DockerHubError);
      const err = e as DockerHubError;
      expect(err.code).toBe(DOCKER_HUB_ERROR_CODES.UNREACHABLE);
      expect(err.status).toBe(503);
    }
  });

  test('handles invalid JSON as bad response', async () => {
    const mockFetch = createMockFetch([
      {
        urlMatcher: /.*/,
        response: new Response('not-json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        })
      }
    ]);

    const client = createDockerHubClient({ fetch: mockFetch as unknown as typeof fetch });

    try {
      await client.searchRepositories('alpine');
      expect(false).toBe(true);
    } catch (e) {
      expect(e).toBeInstanceOf(DockerHubError);
      const err = e as DockerHubError;
      expect(err.code).toBe(DOCKER_HUB_ERROR_CODES.BAD_RESPONSE);
      expect(err.status).toBe(502);
    }
  });

  test('normalizes error JSON without internals', () => {
    const err = new DockerHubError(DOCKER_HUB_ERROR_CODES.RATE_LIMITED, 'Rate limited', 429, 120);
    const json = normalizeDockerHubError(err);
    expect(json).toEqual({
      code: DOCKER_HUB_ERROR_CODES.RATE_LIMITED,
      message: 'Rate limited',
      status: 429,
      retryAfter: 120
    });
  });

  test('normalizes generic error to request failed', () => {
    const json = normalizeDockerHubError(new Error('something broke'));
    expect(json.code).toBe(DOCKER_HUB_ERROR_CODES.REQUEST_FAILED);
    expect(json.status).toBe(502);
  });

  test('uses DOCKER_HUB_TOKEN from environment', async () => {
    process.env.DOCKER_HUB_TOKEN = 'test-token-123';
    let capturedHeaders: HeadersInit | undefined;
    const mockFetch = async (_url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ results: [], page: 1, page_size: 25, count: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    const client = createDockerHubClient({ fetch: mockFetch as unknown as typeof fetch });
    await client.searchRepositories('test');

    const headers = new Headers(capturedHeaders);
    expect(headers.get('Authorization')).toBe('Bearer test-token-123');

    delete process.env.DOCKER_HUB_TOKEN;
  });
});
