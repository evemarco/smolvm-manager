import { expect, test } from '@playwright/test';

test.describe('auth flows', () => {
  test('redirects to setup when no admin exists', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/setup');
    await expect(page.getByRole('heading', { name: 'Initial Setup' })).toBeVisible();
  });

  test('setup creates admin and redirects to home', async ({ page }) => {
    await page.goto('/setup');

    await page.getByLabel('Username').fill('admin');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('securepass123');
    await page.getByLabel('Confirm Password').fill('securepass123');
    await page.getByRole('button', { name: 'Create Admin Account' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByText('admin', { exact: true })).toBeVisible();
  });

  test('blocks setup after admin exists', async ({ page }) => {
    await page.goto('/setup');
    await expect(page).not.toHaveURL('/setup');
  });

  test('login with valid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('securepass123');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page).toHaveURL('/');
    await expect(page.getByText('admin', { exact: true })).toBeVisible();
  });

  test('login with invalid credentials shows error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('wrongpassword');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page.getByText('Invalid username or password')).toBeVisible();
  });

  test('protected routes redirect to login when not authenticated', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL('/login');
  });

  test('logout clears session', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Username').fill('admin');
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('securepass123');
    await page.getByRole('button', { name: 'Sign In' }).click();

    await expect(page).toHaveURL('/');

    await page.getByRole('button', { name: 'Logout' }).click();
    await expect(page).toHaveURL('/login');

    await page.goto('/');
    await expect(page).toHaveURL('/login');
  });

  test('API returns 401 without session when admin exists', async ({ request }) => {
    const response = await request.get('/api/hello');
    expect(response.status()).toBe(401);
  });
});
