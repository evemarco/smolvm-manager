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

test.describe('vm dashboard', () => {
  test('authenticated empty dashboard renders no-machines state and Create VM button', async ({
    page
  }) => {
    await loginAsAdmin(page);

    // Dashboard should show the empty state
    await expect(page.getByRole('heading', { name: 'Virtual Machines' })).toBeVisible();
    await expect(page.getByText('No virtual machines')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Create new virtual machine' })).toBeVisible();
  });

  test('dashboard shows search and filter controls', async ({ page }) => {
    await loginAsAdmin(page);

    await expect(page.getByPlaceholder('Search machines...')).toBeVisible();
    await expect(page.getByRole('combobox')).toBeVisible();
  });

  test('dashboard shows card and table view toggle', async ({ page }) => {
    await loginAsAdmin(page);

    await expect(page.getByRole('button', { name: 'Card view' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Table view' })).toBeVisible();
  });

  test('dashboard shows refresh button', async ({ page }) => {
    await loginAsAdmin(page);

    await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  });

  test('switching to table view keeps the empty state when there are no machines', async ({
    page
  }) => {
    await loginAsAdmin(page);

    await page.getByRole('button', { name: 'Table view' }).click();

    await expect(page.getByText('No virtual machines')).toBeVisible();
  });

  test('delete confirmation modal opens and cancel does not call delete', async ({ page }) => {
    await loginAsAdmin(page);

    // Since there are no VMs, we need to mock the API to return a VM
    // Intercept the machines API to return a test VM
    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          machines: [
            { name: 'test-vm', status: 'stopped', state: 'stopped', cpus: 2, memory: '512M' }
          ]
        })
      });
    });

    // Intercept delete API to track if it's called
    let deleteCalled = false;
    await page.route('**/api/smolvm/machines/test-vm', async (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        await route.fulfill({ status: 200, body: JSON.stringify({ success: true }) });
      } else {
        await route.continue();
      }
    });

    await page.goto('/');
    await expect(page.getByText('test-vm')).toBeVisible();

    // Click the actions menu button for the VM
    await page.getByRole('button', { name: 'Actions for test-vm' }).click();

    // Click Delete
    await page.getByRole('button', { name: 'Delete' }).click();

    // Confirmation modal should appear
    await expect(page.getByText('Are you sure you want to delete')).toBeVisible();

    // Click Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Modal should close
    await expect(page.getByText('Are you sure you want to delete')).not.toBeVisible();

    // Delete should NOT have been called
    expect(deleteCalled).toBe(false);
  });

  test('restart confirmation modal opens and cancel does not call restart', async ({ page }) => {
    await loginAsAdmin(page);

    // Intercept the machines API to return a running VM
    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          machines: [
            { name: 'running-vm', status: 'running', state: 'running', cpus: 2, memory: '512M' }
          ]
        })
      });
    });

    // Intercept stop/start APIs to track calls
    let stopCalled = false;
    let startCalled = false;
    await page.route('**/api/smolvm/machines/running-vm/stop', async (route) => {
      stopCalled = true;
      await route.fulfill({ status: 200, body: JSON.stringify({ success: true }) });
    });
    await page.route('**/api/smolvm/machines/running-vm/start', async (route) => {
      startCalled = true;
      await route.fulfill({ status: 200, body: JSON.stringify({ success: true }) });
    });

    await page.goto('/');
    await expect(page.getByText('running-vm')).toBeVisible();

    // Click the actions menu button for the VM
    await page.getByRole('button', { name: 'Actions for running-vm' }).click();

    // Click Restart
    await page.getByRole('button', { name: 'Restart' }).click();

    // Confirmation modal should appear
    await expect(page.getByText('Restart "running-vm"?')).toBeVisible();

    // Click Cancel
    await page.getByRole('button', { name: 'Cancel' }).click();

    // Modal should close
    await expect(page.getByText('Restart "running-vm"?')).not.toBeVisible();

    // Restart should NOT have been called
    expect(stopCalled).toBe(false);
    expect(startCalled).toBe(false);
  });

  test('clicking VM name opens detail view with tabs', async ({ page }) => {
    await loginAsAdmin(page);

    // Intercept the machines API to return a test VM
    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          machines: [
            { name: 'detail-vm', status: 'running', state: 'running', cpus: 4, memory: '1G' }
          ]
        })
      });
    });

    await page.goto('/');
    await expect(page.getByText('detail-vm')).toBeVisible();

    // Click on the VM name to open detail view
    await page.getByRole('button', { name: 'View details for detail-vm' }).click();

    // Detail view should show the VM name and tabs
    await expect(page.getByRole('heading', { name: 'detail-vm', level: 2 })).toBeVisible();

    // Overview tab should be active by default
    await expect(page.getByRole('button', { name: 'Overview' })).toBeVisible();

    // Placeholder tabs should be disabled
    await expect(page.getByRole('button', { name: 'Config' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Logs' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Terminal' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Metrics' })).toBeDisabled();

    // Back button should be visible
    await expect(page.getByRole('button', { name: 'Back to machine list' })).toBeVisible();
  });

  test('search filters machines by name', async ({ page }) => {
    await loginAsAdmin(page);

    // Intercept the machines API to return multiple VMs
    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          machines: [
            { name: 'alpha-vm', status: 'running', state: 'running' },
            { name: 'beta-vm', status: 'stopped', state: 'stopped' },
            { name: 'gamma-vm', status: 'running', state: 'running' }
          ]
        })
      });
    });

    await page.goto('/');
    await expect(page.getByText('alpha-vm')).toBeVisible();
    await expect(page.getByText('beta-vm')).toBeVisible();
    await expect(page.getByText('gamma-vm')).toBeVisible();

    // Search for "alpha"
    await page.getByPlaceholder('Search machines...').fill('alpha');

    // Only alpha-vm should be visible
    await expect(page.getByText('alpha-vm')).toBeVisible();
    await expect(page.getByText('beta-vm')).not.toBeVisible();
    await expect(page.getByText('gamma-vm')).not.toBeVisible();
  });

  test('status filter filters machines by status', async ({ page }) => {
    await loginAsAdmin(page);

    // Intercept the machines API to return multiple VMs
    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          machines: [
            { name: 'alpha-vm', status: 'running', state: 'running' },
            { name: 'beta-vm', status: 'stopped', state: 'stopped' }
          ]
        })
      });
    });

    await page.goto('/');
    await expect(page.getByText('alpha-vm')).toBeVisible();
    await expect(page.getByText('beta-vm')).toBeVisible();

    // Filter by "Running" status
    await page.getByRole('combobox').selectOption({ value: 'running' });

    // Only running VM should be visible
    await expect(page.getByText('alpha-vm')).toBeVisible();
    await expect(page.getByText('beta-vm')).not.toBeVisible();
  });
});
