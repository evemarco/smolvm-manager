import { expect, test } from '@playwright/test';

test('home page renders the manager scaffold', async ({ page }) => {
  await page.goto('/');

  // If no admin exists, complete setup first
  if (page.url().includes('/setup')) {
    await page.getByLabel('Username').fill('admin');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('securepass123');
    await page.getByLabel('Confirm Password').fill('securepass123');
    await page.getByRole('button', { name: 'Create Admin Account' }).click();
  }

  // If not logged in, log in
  if (page.url().includes('/login')) {
    await page.getByLabel('Username').fill('admin');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('securepass123');
    await page.getByRole('button', { name: 'Sign In' }).click();
  }

  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'SmolVM Manager' })).toBeVisible();
  await expect(
    page.getByText('LAN/Tailscale-ready control plane for local SmolVM operations.')
  ).toBeVisible();
});
