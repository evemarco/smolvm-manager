import { expect, test, type Page } from '@playwright/test';

// Helper: authenticate as admin
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

const RUNNING_VM = {
  name: 'shortcut-vm',
  status: 'running',
  state: 'running',
  cpus: 2,
  memory: '512M'
};

async function mockOneRunningVm(page: Page) {
  await page.route('**/api/smolvm/machines', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ machines: [RUNNING_VM] })
    });
  });
}

async function mockTabWebsockets(page: Page) {
  // VmTerminal opens a websocket; stub the upgrade endpoint so the page doesn't hang.
  await page.route('**/api/smolvm/machines/shortcut-vm/terminal/ws', async (route) => {
    // Respond with a non-upgrade so the component fails gracefully and moves on
    await route.fulfill({ status: 400, body: 'ws stub' });
  });
  // VmLogs SSE
  await page.route('**/api/smolvm/machines/shortcut-vm/logs/stream', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ''
    });
  });
  // VmGuestLogs SSE
  await page.route('**/api/smolvm/machines/shortcut-vm/guest-logs/stream', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: ''
    });
  });
}

test.describe('vm quick actions (Logs / Terminal shortcuts)', () => {
  test('card view: Logs icon opens detail view with Logs tab active', async ({ page }) => {
    await loginAsAdmin(page);
    await mockOneRunningVm(page);
    await mockTabWebsockets(page);

    await page.goto('/');
    await expect(page.getByText('shortcut-vm')).toBeVisible();

    // Default view is cards — click Logs icon button on the card
    await page.getByRole('button', { name: 'Logs for shortcut-vm' }).click();

    // Detail view should open with Logs tab ACTIVE (not Overview)
    await expect(page.getByRole('heading', { name: 'shortcut-vm', level: 2 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Logs', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  test('card view: Terminal icon opens detail view with Terminal tab active', async ({ page }) => {
    await loginAsAdmin(page);
    await mockOneRunningVm(page);
    await mockTabWebsockets(page);

    await page.goto('/');
    await expect(page.getByText('shortcut-vm')).toBeVisible();

    await page.getByRole('button', { name: 'Terminal for shortcut-vm' }).click();

    await expect(page.getByRole('heading', { name: 'shortcut-vm', level: 2 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Terminal', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  test('table view: Logs icon opens detail view with Logs tab active', async ({ page }) => {
    await loginAsAdmin(page);
    await mockOneRunningVm(page);
    await mockTabWebsockets(page);

    await page.goto('/');
    await expect(page.getByText('shortcut-vm')).toBeVisible();

    await page.getByRole('button', { name: 'Table view' }).click();
    await page.getByRole('button', { name: 'Logs for shortcut-vm' }).click();

    await expect(page.getByRole('heading', { name: 'shortcut-vm', level: 2 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Logs', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test('table view: Terminal icon opens detail view with Terminal tab active', async ({ page }) => {
    await loginAsAdmin(page);
    await mockOneRunningVm(page);
    await mockTabWebsockets(page);

    await page.goto('/');
    await expect(page.getByText('shortcut-vm')).toBeVisible();

    await page.getByRole('button', { name: 'Table view' }).click();
    await page.getByRole('button', { name: 'Terminal for shortcut-vm' }).click();

    await expect(page.getByRole('heading', { name: 'shortcut-vm', level: 2 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Terminal', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  test('clicking the VM name still opens detail view with Overview tab active', async ({
    page
  }) => {
    await loginAsAdmin(page);
    await mockOneRunningVm(page);
    await mockTabWebsockets(page);

    await page.goto('/');
    await expect(page.getByText('shortcut-vm')).toBeVisible();

    // The original card-name button opens the detail with Overview active
    await page.getByRole('button', { name: 'View details for shortcut-vm' }).click();

    await expect(page.getByRole('heading', { name: 'shortcut-vm', level: 2 })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });
});
