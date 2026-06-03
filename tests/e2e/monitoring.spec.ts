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

// Parsed capacity shape (camelCase) — matches what parseCapacityResponse returns
const MOCK_CAPACITY = {
  allocatedCpus: 4,
  allocatedMemoryMb: 8192,
  usedCpus: 2.5,
  usedMemoryMb: 4096,
  usedDiskGb: 50
};

const MOCK_METRICS = {
  capacity: MOCK_CAPACITY,
  summary: {
    machinesRunning: 2,
    machinesTotal: 3,
    perVmUnavailable: true
  },
  sampledAt: new Date().toISOString()
};

const MOCK_MACHINES = {
  machines: [{ name: 'test-vm', status: 'running', state: 'running', cpus: 2, memoryMb: 2048 }]
};

test.describe('metrics dashboard', () => {
  test('capacity summary shows on dashboard', async ({ page }) => {
    await loginAsAdmin(page);

    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_MACHINES)
      });
    });

    await page.route('**/api/smolvm/capacity', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_CAPACITY)
      });
    });

    await page.goto('/');
    await expect(page.getByText('Virtual Machines')).toBeVisible({ timeout: 10000 });

    await expect(page.getByText('CPU')).toBeVisible();
    await expect(page.getByText('Memory')).toBeVisible();
    await expect(page.getByText('Disk')).toBeVisible();
  });

  test('metrics tab shows capacity cards and per-VM unavailable notice', async ({ page }) => {
    await loginAsAdmin(page);

    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_MACHINES)
      });
    });

    await page.route('**/api/smolvm/metrics', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_METRICS)
      });
    });

    await page.route('**/api/smolvm/metrics/history*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ samples: [] })
      });
    });

    await page.goto('/');
    await expect(page.getByText('test-vm')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'View details for test-vm' }).click();
    await expect(page.getByRole('heading', { name: 'test-vm', level: 2 })).toBeVisible();

    await page.getByRole('button', { name: 'Metrics' }).click();

    await expect(page.getByText('Live metrics')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Per-VM metrics are unavailable')).toBeVisible();
    await expect(page.getByText('CPU').nth(1)).toBeVisible();
    await expect(page.getByText('Memory').nth(1)).toBeVisible();
    await expect(page.getByText('Disk').nth(1)).toBeVisible();
  });

  test('metrics tab shows running VMs count', async ({ page }) => {
    await loginAsAdmin(page);

    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_MACHINES)
      });
    });

    await page.route('**/api/smolvm/metrics', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_METRICS)
      });
    });

    await page.route('**/api/smolvm/metrics/history*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ samples: [] })
      });
    });

    await page.goto('/');
    await expect(page.getByText('test-vm')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'View details for test-vm' }).click();
    await page.getByRole('button', { name: 'Metrics' }).click();

    await expect(page.getByText('Running VMs')).toBeVisible();
    await expect(page.getByText('Total VMs')).toBeVisible();
  });

  test('metrics tab handles error state', async ({ page }) => {
    await loginAsAdmin(page);

    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_MACHINES)
      });
    });

    await page.route('**/api/smolvm/metrics', async (route) => {
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'METRICS_UNAVAILABLE',
          message: 'SmolVM metrics are currently unavailable.'
        })
      });
    });

    await page.goto('/');
    await expect(page.getByText('test-vm')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'View details for test-vm' }).click();
    await page.getByRole('button', { name: 'Metrics' }).click();

    await expect(page.getByText('SmolVM metrics are currently unavailable.')).toBeVisible({
      timeout: 5000
    });
  });

  test('metrics tab shows history chart when samples exist', async ({ page }) => {
    await loginAsAdmin(page);

    const now = new Date();
    const samples = Array.from({ length: 5 }, (_, i) => ({
      id: String(i + 1),
      machineName: null,
      cpu: 1 + i * 0.5,
      memoryMb: 2048 + i * 512,
      diskGb: 10 + i * 5,
      networkRxBytes: 0,
      networkTxBytes: 0,
      sampledAt: new Date(now.getTime() - (4 - i) * 30000).toISOString()
    }));

    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_MACHINES)
      });
    });

    await page.route('**/api/smolvm/metrics', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_METRICS)
      });
    });

    await page.route('**/api/smolvm/metrics/history*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ samples })
      });
    });

    await page.goto('/');
    await expect(page.getByText('test-vm')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'View details for test-vm' }).click();
    await page.getByRole('button', { name: 'Metrics' }).click();

    await expect(page.getByText('CPU Usage History')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Memory Usage History')).toBeVisible();
  });

  test('metrics tab does not show per-VM unavailable notice when per-VM data exists', async ({
    page
  }) => {
    await loginAsAdmin(page);

    const metricsWithPerVm = {
      ...MOCK_METRICS,
      summary: {
        ...MOCK_METRICS.summary,
        perVmUnavailable: false
      }
    };

    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_MACHINES)
      });
    });

    await page.route('**/api/smolvm/metrics', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(metricsWithPerVm)
      });
    });

    await page.route('**/api/smolvm/metrics/history*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ samples: [] })
      });
    });

    await page.goto('/');
    await expect(page.getByText('test-vm')).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'View details for test-vm' }).click();
    await page.getByRole('button', { name: 'Metrics' }).click();

    await expect(page.getByText('Live metrics')).toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Per-VM metrics are unavailable')).not.toBeVisible();
  });
});
