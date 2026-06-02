import { expect, test } from '@playwright/test';

test('home page renders the manager scaffold', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'SmolVM Manager' })).toBeVisible();
  await expect(
    page.getByText('LAN/Tailscale-ready control plane for local SmolVM operations.')
  ).toBeVisible();
});
