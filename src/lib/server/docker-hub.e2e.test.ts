/**
 * Live Docker Hub API contract tests.
 *
 * These hit the real https://hub.docker.com API and are skipped unless
 * DOCKER_HUB_E2E=true is set. Their purpose is to catch upstream contract
 * changes that mocked unit tests cannot see — e.g. when the content/v1
 * search endpoint started returning {} with HTTP 200 for anonymous queries
 * while every mocked test stayed green.
 *
 * Run with: bun run test:docker-hub-e2e
 */
import { describe, expect, test } from 'bun:test';

import { createDockerHubClient } from './docker-hub';

const RUN_E2E = process.env.DOCKER_HUB_E2E === 'true';
const describeE2E = RUN_E2E ? describe : describe.skip;

const NETWORK_TIMEOUT_MS = 20_000;

describeE2E('docker-hub live API contract', () => {
  test(
    'search returns non-empty results for a common query',
    async () => {
      const client = createDockerHubClient();
      const page = await client.searchRepositories('tor', 1, 5);

      expect(page.totalCount).toBeGreaterThan(0);
      expect(page.results.length).toBeGreaterThan(0);
      for (const result of page.results) {
        expect(result.name.length).toBeGreaterThan(0);
        expect(result.namespace.length).toBeGreaterThan(0);
      }
    },
    NETWORK_TIMEOUT_MS
  );

  test(
    'official images are flagged and mapped to the library namespace',
    async () => {
      const client = createDockerHubClient();
      const page = await client.searchRepositories('alpine', 1, 10);

      const official = page.results.find(
        (r) => r.namespace === 'library' && r.name === 'alpine'
      );
      expect(official?.is_official).toBe(true);
    },
    NETWORK_TIMEOUT_MS
  );

  test(
    'listTags returns tagged images for library/alpine',
    async () => {
      const client = createDockerHubClient();
      const page = await client.listTags('library', 'alpine', 1, 5);

      expect(page.results.length).toBeGreaterThan(0);
      expect(page.results[0].name.length).toBeGreaterThan(0);
      expect(page.results[0].images.length).toBeGreaterThan(0);
      expect(page.results[0].images[0].architecture.length).toBeGreaterThan(0);
    },
    NETWORK_TIMEOUT_MS
  );
});
