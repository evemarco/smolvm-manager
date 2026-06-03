import { expect, test, type Page } from '@playwright/test';

// Helper: authenticate as admin (handles both setup and login flows)
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

// Helper: collect console errors and page errors during a test
function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    errors.push(err.message);
  });
  return errors;
}

// Helper: filter sync-related errors, excluding expected browser network logs
function syncErrors(errors: string[]): string[] {
  return errors.filter(
    (e) =>
      !e.includes('Failed to load resource') &&
      (e.toLowerCase().includes('sync') ||
        e.toLowerCase().includes('pylon') ||
        e.toLowerCase().includes('pull') ||
        e.toLowerCase().includes('subscribe'))
  );
}

test.describe('pylon reactive sync', () => {
  test('view mode toggle works and app handles unavailable sync endpoints on reload', async ({
    page
  }) => {
    const errors = collectErrors(page);

    // Provide a machine so the table view actually renders a <table>
    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          machines: [
            { name: 'sync-vm', status: 'running', state: 'running', cpus: 2, memoryMb: 2048 }
          ]
        })
      });
    });

    await loginAsAdmin(page);

    // Wait for the mocked machine to appear before toggling view
    await expect(page.getByText('sync-vm')).toBeVisible();

    // Verify default card view is active
    await expect(page.getByRole('button', { name: 'Card view' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Table view' })).toBeVisible();

    // Toggle to table view
    await page.getByRole('button', { name: 'Table view' }).click();

    // Verify table view renders (table element should be present)
    await expect(page.locator('table')).toBeVisible();
    await expect(page.getByText('sync-vm')).toBeVisible();

    // Reload the page — in mock mode Pylon sync endpoints return 404,
    // so the sync layer gracefully falls back to the default value.
    await page.goto('/');
    await expect(page).toHaveURL('/');
    await expect(page.getByRole('heading', { name: 'Virtual Machines' })).toBeVisible();

    // Critical: no sync-related console errors from initialization or reload
    expect(syncErrors(errors)).toEqual([]);
  });

  test('metrics history chart renders with bounded data and sync does not crash', async ({
    page
  }) => {
    const errors = collectErrors(page);

    const now = new Date();
    const samples = Array.from({ length: 5 }, (_, i) => ({
      id: String(i + 1),
      machineName: 'test-vm',
      cpu: 1 + i * 0.5,
      memoryMb: 2048 + i * 512,
      diskGb: 10 + i * 5,
      networkRxBytes: 0,
      networkTxBytes: 0,
      sampledAt: new Date(now.getTime() - (4 - i) * 30000).toISOString()
    }));

    const mockMetrics = {
      capacity: {
        allocatedCpus: 4,
        allocatedMemoryMb: 8192,
        usedCpus: 2.5,
        usedMemoryMb: 4096,
        usedDiskGb: 50
      },
      summary: {
        machinesRunning: 1,
        machinesTotal: 1,
        perVmUnavailable: false
      },
      sampledAt: new Date().toISOString()
    };

    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          machines: [
            { name: 'test-vm', status: 'running', state: 'running', cpus: 2, memoryMb: 2048 }
          ]
        })
      });
    });

    await page.route('**/api/smolvm/metrics', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mockMetrics)
      });
    });

    await page.route('**/api/smolvm/metrics/history*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ samples })
      });
    });

    await loginAsAdmin(page);

    // Navigate to VM detail and open Metrics tab
    await page.goto('/');
    await expect(page.getByText('test-vm')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'View details for test-vm' }).click();
    await expect(page.getByRole('heading', { name: 'test-vm', level: 2 })).toBeVisible();

    await page.getByRole('tab', { name: 'Metrics' }).click();

    // Verify live metrics render
    await expect(page.getByText('Live metrics')).toBeVisible({ timeout: 5000 });

    // Verify history chart headings render (requires >1 sample)
    await expect(page.getByText('CPU Usage History')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Memory Usage History')).toBeVisible();

    // Verify bar chart bars are present
    const cpuBars = page.locator('h4:has-text("CPU Usage History") + div > div');
    await expect(cpuBars.first()).toBeVisible();

    // No sync-related console errors
    expect(syncErrors(errors)).toEqual([]);
  });

  test('sync engine initializes without console errors in mock mode', async ({ page }) => {
    const errors = collectErrors(page);

    await loginAsAdmin(page);

    // Dashboard should load cleanly
    await expect(page.getByRole('heading', { name: 'Virtual Machines' })).toBeVisible();

    // Wait a moment for any async sync initialization to complete
    await page.waitForTimeout(1500);

    // No sync-related console errors (network 404s from mock mode are expected
    // and logged by the browser, but the sync layer itself must not throw)
    expect(syncErrors(errors)).toEqual([]);
  });
});
