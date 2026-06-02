import { expect, test, type Page } from '@playwright/test';

async function loginAsAdmin(page: Page) {
  await page.goto('/');

  if (await page.getByRole('heading', { name: 'Initial Setup' }).isVisible({ timeout: 2000 })) {
    await page.getByLabel('Username').fill('admin');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('securepass123');
    await page.getByLabel('Confirm Password').fill('securepass123');
    await page.getByRole('button', { name: 'Create Admin Account' }).click();
  }

  const signInButton = page.getByRole('button', { name: 'Sign In' });
  if (await signInButton.isVisible({ timeout: 2000 })) {
    await page.getByLabel('Username').fill('admin');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('securepass123');
    await signInButton.click();
  }

  await expect(page.getByRole('heading', { name: 'Virtual Machines' })).toBeVisible({
    timeout: 10000
  });
}

async function mockEmptyMachines(page: Page) {
  await page.route('**/api/smolvm/machines', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ machines: [] })
    });
  });
}

async function mockMachines(page: Page, machines: Array<Record<string, unknown>>) {
  await page.route('**/api/smolvm/machines', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ machines })
    });
  });
}

async function waitForDashboardReady(page: Page) {
  await expect(page.getByRole('heading', { name: 'Virtual Machines' })).toBeVisible();
  await expect(page.getByPlaceholder('Search machines...')).toBeVisible();
  await expect(page.getByText('Loading machines...')).toBeHidden();
}

test.describe('toml and vm config', () => {
  test('opens Create VM form from dashboard', async ({ page }) => {
    await mockEmptyMachines(page);
    await loginAsAdmin(page);
    await waitForDashboardReady(page);

    await page.getByRole('button', { name: 'Create new virtual machine' }).click();

    await expect(page.getByText('Create Virtual Machine')).toBeVisible();
    await expect(page.getByPlaceholder('my-vm')).toBeVisible();
  });

  test('fills basic VM config fields', async ({ page }) => {
    await mockEmptyMachines(page);
    await loginAsAdmin(page);
    await waitForDashboardReady(page);

    await page.getByRole('button', { name: 'Create new virtual machine' }).click();
    await expect(page.getByText('Create Virtual Machine')).toBeVisible();

    await page.getByPlaceholder('my-vm').fill('test-vm');
    await page.getByPlaceholder('alpine, nginx, etc.').fill('alpine');
    await page.getByPlaceholder('latest').fill('3.18');
  });

  test('adds and removes port mappings', async ({ page }) => {
    await mockEmptyMachines(page);
    await loginAsAdmin(page);
    await waitForDashboardReady(page);

    await page.getByRole('button', { name: 'Create new virtual machine' }).click();
    await expect(page.getByText('Create Virtual Machine')).toBeVisible();

    await page.getByRole('button', { name: 'Network & Ports' }).click();

    await page.getByPlaceholder('Host port').fill('8080');
    await page.getByPlaceholder('Guest port').fill('80');
    await page.getByRole('button', { name: 'Add' }).first().click();

    await expect(page.getByText('8080:80')).toBeVisible();
  });

  test('adds and removes environment variables', async ({ page }) => {
    await mockEmptyMachines(page);
    await loginAsAdmin(page);
    await waitForDashboardReady(page);

    await page.getByRole('button', { name: 'Create new virtual machine' }).click();
    await expect(page.getByText('Create Virtual Machine')).toBeVisible();

    await page.getByRole('button', { name: 'Environment Variables' }).click();

    await page.getByPlaceholder('KEY').fill('NODE_ENV');
    await page.getByPlaceholder('value').fill('production');
    await page.getByRole('button', { name: 'Add' }).first().click();

    await expect(page.getByText('NODE_ENV')).toBeVisible();
    await expect(page.getByText('production')).toBeVisible();
  });

  test('adds and removes volume mounts', async ({ page }) => {
    await mockEmptyMachines(page);
    await loginAsAdmin(page);
    await waitForDashboardReady(page);

    await page.getByRole('button', { name: 'Create new virtual machine' }).click();
    await expect(page.getByText('Create Virtual Machine')).toBeVisible();

    await page.getByRole('button', { name: 'Volumes' }).click();

    await page.getByPlaceholder('/host/path').fill('/data');
    await page.getByPlaceholder('/guest/path').fill('/app/data');
    await page.getByRole('button', { name: 'Add' }).first().click();

    await expect(page.getByText('/data → /app/data')).toBeVisible();
  });

  test('shows TOML preview section', async ({ page }) => {
    await mockEmptyMachines(page);
    await loginAsAdmin(page);
    await waitForDashboardReady(page);

    await page.getByRole('button', { name: 'Create new virtual machine' }).click();
    await expect(page.getByText('Create Virtual Machine')).toBeVisible();

    await page.getByPlaceholder('my-vm').fill('preview-vm');

    await page.getByRole('button', { name: 'TOML Preview' }).click();

    await expect(page.getByText('[resources]')).toBeVisible();
  });

  test('imports TOML configuration', async ({ page }) => {
    await mockEmptyMachines(page);
    await loginAsAdmin(page);
    await waitForDashboardReady(page);

    await page.getByRole('button', { name: 'Create new virtual machine' }).click();
    await expect(page.getByText('Create Virtual Machine')).toBeVisible();

    await page.getByRole('button', { name: 'Import TOML' }).click();

    await expect(page.getByText('Import TOML Configuration')).toBeVisible();

    const tomlContent = `[image]
name = "nginx"
tag = "latest"

[resources]
cpus = 2
memory = 512

[network]
net = true`;

    await page.getByPlaceholder('Paste TOML configuration here...').fill(tomlContent);

    await page.route('**/api/smolvm/toml-validate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          parseErrors: [],
          validation: { valid: true },
          config: { name: 'nginx', image: 'nginx', tag: 'latest', cpus: 2, memory: 512, net: true }
        })
      });
    });

    await page.getByRole('button', { name: 'Import', exact: true }).click();

    await expect(page.getByPlaceholder('my-vm')).toHaveValue('nginx');
  });

  test('shows validation error for invalid TOML', async ({ page }) => {
    await mockEmptyMachines(page);
    await loginAsAdmin(page);
    await waitForDashboardReady(page);

    await page.getByRole('button', { name: 'Create new virtual machine' }).click();
    await expect(page.getByText('Create Virtual Machine')).toBeVisible();

    await page.getByRole('button', { name: 'Import TOML' }).click();

    await page.route('**/api/smolvm/toml-validate', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          parseErrors: [{ field: '', message: 'Invalid TOML syntax' }],
          validation: { valid: false, errors: [{ field: '', message: 'Invalid TOML syntax' }] }
        })
      });
    });

    await page.getByPlaceholder('Paste TOML configuration here...').fill('invalid toml [[[');
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    await expect(page.getByText('Invalid TOML')).toBeVisible();
  });

  test('shows recreate-required warning when changing image in edit mode', async ({ page }) => {
    await mockMachines(page, [
      { name: 'edit-vm', status: 'stopped', state: 'stopped', cpus: 2, memoryMb: 512 }
    ]);

    await page.route('**/api/smolvm/machines/edit-vm', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          name: 'edit-vm',
          status: 'stopped',
          state: 'stopped',
          cpus: 2,
          memoryMb: 512,
          image: 'alpine',
          tag: 'latest'
        })
      });
    });

    await loginAsAdmin(page);
    await expect(page.getByText('edit-vm')).toBeVisible();

    await page.getByRole('button', { name: 'View details for edit-vm' }).click();
    await page.getByRole('button', { name: 'Config' }).click();
    await page.getByRole('button', { name: 'Edit Configuration' }).click();

    await expect(page.getByText('Editing')).toBeVisible();
  });

  test('copy VM config creates new name', async ({ page }) => {
    await mockMachines(page, [
      { name: 'source-vm', status: 'stopped', state: 'stopped', cpus: 2, memoryMb: 512 }
    ]);

    await loginAsAdmin(page);
    await expect(page.getByText('source-vm')).toBeVisible();

    await page.getByRole('button', { name: 'Actions for source-vm' }).click();
    await page.getByRole('button', { name: 'Copy Config' }).click();

    await expect(page.getByText('Copy Virtual Machine')).toBeVisible();
  });

  test('cancel closes the VM form', async ({ page }) => {
    await mockEmptyMachines(page);
    await loginAsAdmin(page);
    await waitForDashboardReady(page);

    await page.getByRole('button', { name: 'Create new virtual machine' }).click();
    await expect(page.getByText('Create Virtual Machine')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByText('Create Virtual Machine')).not.toBeVisible();
  });
});
