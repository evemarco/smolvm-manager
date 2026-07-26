import { expect, test, type Page } from '@playwright/test';

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/');

  const setup = page.getByRole('heading', { name: 'Initial Setup' });
  const signIn = page.getByRole('heading', { name: 'Sign In' });
  const dashboard = page.getByRole('heading', { name: 'Virtual Machines' });

  if (await setup.isVisible()) {
    await page.getByLabel('Username').fill('admin');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('securepass123');
    await page.getByLabel('Confirm Password').fill('securepass123');
    await page.getByRole('button', { name: 'Create Admin Account' }).click();
  }

  if (await signIn.isVisible()) {
    await page.getByLabel('Username').fill('admin');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('securepass123');
    await page.getByRole('button', { name: 'Sign In' }).click();
  }

  await expect(dashboard).toBeVisible({ timeout: 15_000 });
}

test('admin can open backend diagnostics from the application navigation', async ({ page }) => {
  await loginAsAdmin(page);

  await page.getByRole('link', { name: 'Diagnostics' }).click();

  await expect(page.getByRole('heading', { name: 'Backend diagnostics' })).toBeVisible();
  await expect(page.getByText('No backend errors recorded')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Diagnostics' })).toHaveAttribute(
    'aria-current',
    'page'
  );
});

test('admin can refresh backend diagnostics without navigating away', async ({ page }) => {
  await loginAsAdmin(page);
  await page.getByRole('link', { name: 'Diagnostics' }).click();

  const refresh = page.getByRole('button', { name: 'Refresh diagnostics' });
  const refreshedAt = page.getByText(/^Last refreshed /);

  await expect(refresh).toBeEnabled();
  const previousTimestamp = await refreshedAt.getAttribute('datetime');

  await refresh.click();

  await expect(page).toHaveURL(/\/diagnostics$/);
  await expect.poll(() => refreshedAt.getAttribute('datetime')).not.toBe(previousTimestamp);
  await expect(refresh).toBeEnabled();
});
