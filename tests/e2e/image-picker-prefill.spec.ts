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

async function mockDockerHubSearch(page: Page, namespace = 'library', repository = 'alpine') {
  await page.route('**/api/smolvm/docker-hub/search**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [{ name: repository, namespace, is_official: true }],
        page: 1,
        pageSize: 25,
        totalCount: 1
      })
    });
  });
}

async function mockDockerHubTags(page: Page, tag = 'latest') {
  await page.route('**/api/smolvm/docker-hub/tags**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        results: [
          {
            name: tag,
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
}

test.describe('image picker prefill', () => {
  test('prefills the VM create form from a selected Docker Hub tag', async ({ page }) => {
    await loginAsAdmin(page);
    await mockDockerHubSearch(page);
    await mockDockerHubTags(page, 'latest');

    await openImagePicker(page);
    await page.getByPlaceholder('Search Docker Hub').fill('alpine');
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByText('library/alpine').click();
    await page.getByText('latest').click();
    await page.getByText('Select').click();

    await expect(page.getByRole('heading', { name: 'Create Virtual Machine' })).toBeVisible();
    await expect(page.getByLabel('Image')).toHaveValue('library/alpine');
    await expect(page.getByLabel('Tag')).toHaveValue('latest');
    await expect(page.getByLabel('Machine Name')).toHaveValue('');
  });

  test('clears prefilled image state after cancelling and reopening a blank create form', async ({
    page
  }) => {
    await loginAsAdmin(page);
    await mockDockerHubSearch(page);
    await mockDockerHubTags(page, 'latest');

    await openImagePicker(page);
    await page.getByPlaceholder('Search Docker Hub').fill('alpine');
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByText('library/alpine').click();
    await page.getByText('latest').click();
    await page.getByText('Select').click();

    const formDialog = page.getByRole('dialog');
    await formDialog.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Create new virtual machine' }).click();

    await expect(page.getByRole('heading', { name: 'Create Virtual Machine' })).toBeVisible();
    await expect(page.getByLabel('Image')).toHaveValue('');
    await expect(page.getByLabel('Tag')).toHaveValue('');
    await expect(page.getByLabel('Machine Name')).toHaveValue('');
  });
});
