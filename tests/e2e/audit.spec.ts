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

const SAMPLE_EVENTS = [
  {
    id: 'evt-1',
    eventType: 'vm.lifecycle',
    actorUserId: 'admin-1',
    action: 'vm.start',
    details: JSON.stringify({ machineName: 'web-01' }),
    ipAddress: '10.0.0.5',
    createdAt: '2026-07-25T10:30:00.000Z'
  },
  {
    id: 'evt-2',
    eventType: 'auth',
    actorUserId: 'admin-1',
    action: 'login',
    details: JSON.stringify({ method: 'password' }),
    ipAddress: '10.0.0.5',
    createdAt: '2026-07-25T09:00:00.000Z'
  },
  {
    id: 'evt-3',
    eventType: 'terminal',
    actorUserId: 'admin-1',
    action: 'terminal.open',
    details: JSON.stringify({ machineName: 'db-01' }),
    ipAddress: '10.0.0.5',
    createdAt: '2026-07-25T08:00:00.000Z'
  }
];

test.describe('audit events page', () => {
  test('renders audit table with expected columns and rows from mocked API', async ({ page }) => {
    await loginAsAdmin(page);

    let fetchCount = 0;
    await page.route('**/api/audit/events*', async (route) => {
      fetchCount++;
      const url = new URL(route.request().url());
      const limit = Number(url.searchParams.get('limit') ?? '50');
      const slice = SAMPLE_EVENTS.slice(0, Math.min(limit, SAMPLE_EVENTS.length));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ events: slice })
      });
    });

    await page.goto('/audit');

    // Table header columns
    await expect(page.getByRole('columnheader', { name: 'Type' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Actor' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Action' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Details' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Date' })).toBeVisible();

    // Rows content
    await expect(page.getByText('vm.lifecycle', { exact: true })).toBeVisible();
    await expect(page.getByText('vm.start', { exact: true })).toBeVisible();
    await expect(page.getByText(/web-01/)).toBeVisible();
    await expect(page.getByText('auth', { exact: true })).toBeVisible();
    await expect(page.getByText('login', { exact: true })).toBeVisible();
    await expect(page.getByText('terminal', { exact: true })).toBeVisible();
    await expect(page.getByText('terminal.open', { exact: true })).toBeVisible();
    await expect(page.getByText(/db-01/)).toBeVisible();

    // Load more button is present
    const loadMore = page.getByRole('button', { name: /load more/i });
    await expect(loadMore).toBeVisible();

    // Initial fetch should have happened
    expect(fetchCount).toBeGreaterThanOrEqual(1);

    // Click Load more and confirm another fetch
    await loadMore.click();
    await expect.poll(() => fetchCount).toBeGreaterThanOrEqual(2);
  });

  test('shows empty state when no events exist', async ({ page }) => {
    await loginAsAdmin(page);

    await page.route('**/api/audit/events*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ events: [] })
      });
    });

    await page.goto('/audit');
    await expect(page.getByText(/no audit events/i)).toBeVisible();
  });

  test('shows error state when API fails', async ({ page }) => {
    await loginAsAdmin(page);

    await page.route('**/api/audit/events*', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'boom' })
      });
    });

    await page.goto('/audit');
    await expect(page.getByText(/failed to load|error/i)).toBeVisible();
  });
});
