import { expect, test, type Page } from '@playwright/test';

async function loginAsAdmin(page: Page) {
  await page.goto('/');

  if (await page.getByRole('heading', { name: 'Initial Setup' }).isVisible({ timeout: 1000 })) {
    await page.getByLabel('Username').fill('admin');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('securepass123');
    await page.getByLabel('Confirm Password').fill('securepass123');
    await page.getByRole('button', { name: 'Create Admin Account' }).click();
  }

  if (await page.getByRole('heading', { name: 'Sign In' }).isVisible({ timeout: 1000 })) {
    await page.getByLabel('Username').fill('admin');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('securepass123');
    await page.getByRole('button', { name: 'Sign In' }).click();
  }

  await expect(page).toHaveURL('/');
}

async function waitForDashboardReady(page: Page) {
  await expect(page.getByRole('heading', { name: 'Virtual Machines' })).toBeVisible();
  await expect(page.getByPlaceholder('Search machines...')).toBeVisible();
  await expect(page.getByText('Loading machines...')).toBeHidden();
}

async function openImagePicker(page: Page) {
  await waitForDashboardReady(page);
  await page.getByRole('button', { name: 'Browse Images' }).first().click();
}

test.describe('image picker', () => {
  test('opens image picker from dashboard and shows search UI', async ({ page }) => {
    await loginAsAdmin(page);

    await openImagePicker(page);

    await expect(page.getByRole('heading', { name: 'Docker Hub Image Search' })).toBeVisible();
    await expect(page.getByPlaceholder('Search Docker Hub')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Search' })).toBeVisible();
  });

  test('searches Docker Hub and displays results with official badge', async ({ page }) => {
    await loginAsAdmin(page);

    // Mock search API
    await page.route('**/api/smolvm/docker-hub/search**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              name: 'alpine',
              namespace: 'library',
              description: 'A minimal Docker image based on Alpine Linux',
              is_official: true,
              star_count: 5000,
              pull_count: 1000000
            },
            {
              name: 'myapp',
              namespace: 'user123',
              description: 'A custom application image',
              is_official: false,
              star_count: 12,
              pull_count: 340
            }
          ],
          page: 1,
          pageSize: 25,
          totalCount: 2,
          nextPage: undefined
        })
      });
    });

    await openImagePicker(page);
    await page.getByPlaceholder('Search Docker Hub').fill('alpine');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText('library/alpine')).toBeVisible();
    await expect(page.locator('span', { hasText: 'Official' }).first()).toBeVisible();
    await expect(page.getByText('user123/myapp')).toBeVisible();
    await expect(page.locator('span', { hasText: 'Community' }).first()).toBeVisible();
  });

  test('selects repository and shows tags with metadata', async ({ page }) => {
    await loginAsAdmin(page);

    await page.route('**/api/smolvm/docker-hub/search**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [{ name: 'alpine', namespace: 'library', is_official: true }],
          page: 1,
          pageSize: 25,
          totalCount: 1
        })
      });
    });

    await page.route('**/api/smolvm/docker-hub/tags**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              name: 'latest',
              digest: 'sha256:abc123def456',
              images: [{ architecture: 'amd64', os: 'linux', size: 1234567 }],
              lastUpdated: '2024-01-15T10:30:00Z',
              tag_last_pushed: '2024-01-15T10:30:00Z',
              size: 1234567
            },
            {
              name: '3.18',
              digest: 'sha256:def789abc012',
              images: [
                { architecture: 'amd64', os: 'linux', size: 987654 },
                { architecture: 'arm64', os: 'linux', size: 950000 }
              ],
              lastUpdated: '2024-01-10T08:00:00Z',
              tag_last_pushed: '2024-01-10T08:00:00Z',
              size: 987654
            }
          ],
          page: 1,
          pageSize: 25,
          totalCount: 2
        })
      });
    });

    await openImagePicker(page);
    await page.getByPlaceholder('Search Docker Hub').fill('alpine');
    await page.getByRole('button', { name: 'Search' }).click();

    await page.getByText('library/alpine').click();

    await expect(page.getByRole('heading', { name: 'library/alpine' })).toBeVisible();
    await expect(page.getByText('latest')).toBeVisible();
    await expect(page.getByText('3.18')).toBeVisible();
    await expect(page.getByText('amd64, arm64')).toBeVisible();
    await expect(page.getByText('1.18 MB')).toBeVisible();
  });

  test('selects a tag and emits selection', async ({ page }) => {
    await loginAsAdmin(page);

    await page.route('**/api/smolvm/docker-hub/search**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [{ name: 'alpine', namespace: 'library', is_official: true }],
          page: 1,
          pageSize: 25,
          totalCount: 1
        })
      });
    });

    await page.route('**/api/smolvm/docker-hub/tags**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results: [
            {
              name: 'latest',
              digest: 'sha256:abc123',
              images: [{ architecture: 'amd64', os: 'linux', size: 1234567 }],
              lastUpdated: '2024-01-15T10:30:00Z',
              tag_last_pushed: '2024-01-15T10:30:00Z',
              size: 1234567
            }
          ],
          page: 1,
          pageSize: 25,
          totalCount: 1
        })
      });
    });

    await openImagePicker(page);
    await page.getByPlaceholder('Search Docker Hub').fill('alpine');
    await page.getByRole('button', { name: 'Search' }).click();

    await page.getByText('library/alpine').click();
    await expect(page.getByText('latest')).toBeVisible();

    await page.getByText('Select').click();

    // Modal should close after selection
    await expect(page.getByRole('heading', { name: 'library/alpine' })).not.toBeVisible();

    // Toast should appear
    await expect(page.getByText('Selected image: library/alpine:latest')).toBeVisible();
  });

  test('handles rate limit error with retry info', async ({ page }) => {
    await loginAsAdmin(page);

    await page.route('**/api/smolvm/docker-hub/search**', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'DOCKER_HUB_RATE_LIMITED',
          message: 'Docker Hub rate limit exceeded. Please try again later.',
          status: 429,
          retryAfter: 60
        })
      });
    });

    await openImagePicker(page);
    await page.getByPlaceholder('Search Docker Hub').fill('alpine');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(
      page.locator('p.text-red-300', { hasText: 'Docker Hub rate limit exceeded' }).first()
    ).toBeVisible();
    await expect(page.getByText('Retry after 60 seconds')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('paginates search results', async ({ page }) => {
    await loginAsAdmin(page);

    let requestPage = 1;
    await page.route('**/api/smolvm/docker-hub/search**', async (route) => {
      const url = new URL(route.request().url());
      requestPage = parseInt(url.searchParams.get('page') ?? '1', 10);

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          results:
            requestPage === 1
              ? [{ name: 'alpine', namespace: 'library', is_official: true }]
              : [{ name: 'nginx', namespace: 'library', is_official: true }],
          page: requestPage,
          pageSize: 25,
          totalCount: 2,
          nextPage: requestPage === 1 ? 2 : undefined
        })
      });
    });

    await openImagePicker(page);
    await page.getByPlaceholder('Search Docker Hub').fill('test');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByText('library/alpine')).toBeVisible();

    // Click next page
    await page.getByRole('button', { name: 'Next page' }).click();

    await expect(page.getByText('library/nginx')).toBeVisible();
    await expect(page.getByText('library/alpine')).not.toBeVisible();
  });

  test('closes picker on escape key', async ({ page }) => {
    await loginAsAdmin(page);

    await openImagePicker(page);
    await expect(page.getByRole('heading', { name: 'Docker Hub Image Search' })).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('heading', { name: 'Docker Hub Image Search' })).not.toBeVisible();
  });
});
