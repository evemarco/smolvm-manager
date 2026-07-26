import { expect, test, type Page } from '@playwright/test';

async function waitForAuthState(page: Page, timeoutMs = 15000) {
  const initialSetupHeading = page.getByRole('heading', { name: 'Initial Setup' });
  const signInHeading = page.getByRole('heading', { name: 'Sign In' });
  const dashboardHeading = page.getByRole('heading', { name: 'Virtual Machines' });
  const createVmButton = page.getByRole('button', { name: 'Create new virtual machine' });
  const searchMachinesInput = page.getByPlaceholder('Search machines...');
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if ((await createVmButton.isVisible()) || (await searchMachinesInput.isVisible())) {
      return { dashboardHeading, state: 'dashboard' as const };
    }
    if (await dashboardHeading.isVisible())
      return { dashboardHeading, state: 'dashboard' as const };
    if (await initialSetupHeading.isVisible()) return { dashboardHeading, state: 'setup' as const };
    if (await signInHeading.isVisible()) return { dashboardHeading, state: 'signin' as const };
    await page.waitForTimeout(100);
  }

  throw new Error('Timed out waiting for setup, sign-in, or dashboard state');
}

async function loginAsAdmin(page: Page) {
  await page.goto('/');
  const firstState = await waitForAuthState(page);

  if (firstState.state === 'setup') {
    await page.getByLabel('Username').fill('admin');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('securepass123');
    await page.getByLabel('Confirm Password').fill('securepass123');
    await page.getByRole('button', { name: 'Create Admin Account' }).click();
    const nextState = await waitForAuthState(page);
    if (nextState.state === 'signin') {
      await page.getByLabel('Username').fill('admin');
      await page.getByRole('textbox', { name: 'Password', exact: true }).fill('securepass123');
      await page.getByRole('button', { name: 'Sign In' }).click();
    }
  }

  if (firstState.state === 'signin') {
    await page.getByLabel('Username').fill('admin');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('securepass123');
    await page.getByRole('button', { name: 'Sign In' }).click();
  }

  await expect(firstState.dashboardHeading).toBeVisible({ timeout: 15000 });
}

async function mockMachines(page: Page) {
  await page.route('**/api/smolvm/machines', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        machines: [{ name: 'guest-vm', status: 'running', state: 'running', cpus: 2 }]
      })
    });
  });
}

async function openGuestVmDetail(page: Page) {
  await mockMachines(page);
  await loginAsAdmin(page);
  await expect(page.getByText('guest-vm')).toBeVisible();
  await page.getByRole('button', { name: 'View details for guest-vm' }).click();
  await expect(page.getByRole('heading', { name: 'guest-vm', level: 2 })).toBeVisible();
}

test.describe('guest logs tab', () => {
  test('renders guest log lines with stderr styling and exit banner', async ({ page }) => {
    await page.route('**/api/smolvm/machines/guest-vm/guest-logs**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-store' },
        body:
          'event: line\ndata: {"stream":"stdout","text":"kernel booted"}\n\n' +
          'event: line\ndata: {"stream":"stderr","text":"disk warning"}\n\n' +
          'event: exit\ndata: {"code":0}\n\n'
      });
    });

    await openGuestVmDetail(page);
    await page.getByRole('tab', { name: 'Guest logs' }).click();

    // Pick the journalctl preset
    await page.getByRole('button', { name: 'journalctl' }).click();

    // stdout line renders
    await expect(page.getByLabel('Guest log output')).toContainText('kernel booted');

    // stderr line renders with warning styling
    const stderrLine = page.getByText('disk warning');
    await expect(stderrLine).toBeVisible();
    await expect(stderrLine).toHaveClass(/text-amber/);

    // exit banner shows the code
    await expect(page.getByText(/exit code 0/i)).toBeVisible();
  });

  test('shows graceful error state when VM is not running (409)', async ({ page }) => {
    await page.route('**/api/smolvm/machines/guest-vm/guest-logs**', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'VM not running' })
      });
    });

    await openGuestVmDetail(page);
    await page.getByRole('tab', { name: 'Guest logs' }).click();

    // Pick a preset so the request fires
    await page.getByRole('button', { name: 'journalctl' }).click();

    // Graceful error state — not an empty spinner, not a crash
    await expect(page.getByText(/unavailable|not running|could not start/i)).toBeVisible({
      timeout: 10000
    });

    // Retry button present
    await expect(page.getByRole('button', { name: /retry/i })).toBeVisible();

    // Should NOT be a spinner-only state with no error content
    const spinnerCount = await page.locator('.animate-spin').count();
    const errorContentVisible = await page
      .getByText(/unavailable|not running|could not start/i)
      .isVisible();
    expect(errorContentVisible || spinnerCount === 0).toBe(true);
  });
});
