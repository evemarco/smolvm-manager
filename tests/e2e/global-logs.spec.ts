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

function buildSseBody(): string {
  return (
    'event: ready\ndata: {"machines":["alpha","beta"]}\n\n' +
    'event: log\ndata: {"machine":"alpha","line":"alpha booting kernel"}\n\n' +
    'event: log\ndata: {"machine":"beta","line":"beta accepting connections"}\n\n' +
    'event: log\ndata: {"machine":"alpha","line":"alpha ready"}\n\n'
  );
}

async function openGlobalLogsPanel(page: Page) {
  const toggle = page.getByTestId('global-logs-toggle');
  const panel = page.getByTestId('global-logs-panel');
  await expect(async () => {
    if (!(await panel.isVisible())) {
      await toggle.click();
    }
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15000 });
}

test.describe('global logs panel', () => {
  test('opens panel from dashboard and shows per-machine tagged log lines with distinct colors', async ({
    page
  }) => {
    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          machines: [
            { name: 'alpha', status: 'running', state: 'running', cpus: 2 },
            { name: 'beta', status: 'running', state: 'running', cpus: 2 }
          ]
        })
      });
    });

    await page.route('**/api/smolvm/logs**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-store' },
        body: buildSseBody()
      });
    });

    await loginAsAdmin(page);
    await expect(page.getByPlaceholder('Search machines...')).toBeVisible();

    await openGlobalLogsPanel(page);

    const output = page.getByLabel('Global log output');
    await expect(output).toBeVisible({ timeout: 5000 });

    await expect(output).toContainText('alpha booting kernel');
    await expect(output).toContainText('beta accepting connections');
    await expect(output).toContainText('alpha ready');

    // Each line must be prefixed/tagged with its machine name
    const alphaLines = output.locator('[data-machine="alpha"]');
    const betaLines = output.locator('[data-machine="beta"]');
    await expect(alphaLines).toHaveCount(2);
    await expect(betaLines).toHaveCount(1);

    // Distinct color classes per machine (hashed palette)
    const alphaClass = await alphaLines.first().getAttribute('class');
    const betaClass = await betaLines.first().getAttribute('class');
    expect(alphaClass).toBeTruthy();
    expect(betaClass).toBeTruthy();
    expect(alphaClass).not.toBe(betaClass);
  });

  test('renders gap marker when the server reports dropped lines', async ({ page }) => {
    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          machines: [{ name: 'solo', status: 'running', state: 'running', cpus: 1 }]
        })
      });
    });

    await page.route('**/api/smolvm/logs**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-store' },
        body:
          'event: ready\ndata: {"machines":["solo"]}\n\n' +
          'event: log\ndata: {"machine":"solo","line":"first"}\n\n' +
          'event: gap\ndata: {"machine":"solo","dropped":7}\n\n' +
          'event: log\ndata: {"machine":"solo","line":"after gap"}\n\n'
      });
    });

    await loginAsAdmin(page);
    await expect(page.getByPlaceholder('Search machines...')).toBeVisible();

    await openGlobalLogsPanel(page);

    const output = page.getByLabel('Global log output');
    await expect(output).toContainText('first');
    await expect(output).toContainText('after gap');
    await expect(output).toContainText(/7\s+lines?\s+dropped/i);
  });

  test('pause button pauses and resume button resumes the stream', async ({ page }) => {
    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          machines: [{ name: 'solo', status: 'running', state: 'running', cpus: 1 }]
        })
      });
    });

    // Never respond: the EventSource stays in CONNECTING state, which keeps the
    // panel's Pause label deterministic (a closed mock body oscillates via reconnect).
    await page.route('**/api/smolvm/logs**', () => new Promise(() => {}));

    await loginAsAdmin(page);
    await expect(page.getByPlaceholder('Search machines...')).toBeVisible();

    await openGlobalLogsPanel(page);

    const panel = page.locator('[data-testid="global-logs-panel"]');
    await expect(panel).toBeVisible({ timeout: 5000 });

    await panel.getByRole('button', { name: /pause/i }).click();
    await expect(panel.getByText(/paused/i)).toBeVisible({ timeout: 3000 });

    await panel.getByRole('button', { name: /resume/i }).click();
    await expect(panel.getByText(/connecting/i)).toBeVisible({ timeout: 3000 });
  });

  test('machine badge reflects offline state from machine events', async ({ page }) => {
    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          machines: [{ name: 'flaky', status: 'running', state: 'running', cpus: 1 }]
        })
      });
    });

    await page.route('**/api/smolvm/logs**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-store' },
        body:
          'event: ready\ndata: {"machines":["flaky"]}\n\n' +
          'event: machine\ndata: {"name":"flaky","state":"offline"}\n\n'
      });
    });

    await loginAsAdmin(page);
    await expect(page.getByPlaceholder('Search machines...')).toBeVisible();

    await openGlobalLogsPanel(page);

    const panel = page.locator('[data-testid="global-logs-panel"]');
    await expect(panel).toBeVisible({ timeout: 5000 });

    const badge = panel.locator('[data-testid="machine-badge-flaky"]');
    await expect(badge).toBeVisible({ timeout: 5000 });
    await expect(badge).toContainText(/offline/i);
  });
});
