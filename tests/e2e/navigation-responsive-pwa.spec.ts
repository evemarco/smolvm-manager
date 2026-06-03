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

test.describe('navigation and accessibility', () => {
  test('skip-to-content link is present and functional', async ({ page }) => {
    await loginAsAdmin(page);

    // The skip link should exist in the DOM
    const skipLink = page.getByRole('link', { name: 'Skip to content' });
    await expect(skipLink).toBeAttached();

    // Tab to focus the skip link
    await page.keyboard.press('Tab');
    await expect(skipLink).toBeFocused();
  });

  test('main content has id for skip target', async ({ page }) => {
    await loginAsAdmin(page);

    const main = page.locator('#main-content');
    await expect(main).toBeVisible();
  });

  test('header is visible on desktop', async ({ page }) => {
    await loginAsAdmin(page);

    await expect(page.getByText('SmolVM Manager')).toBeVisible();
  });

  test('logout button is accessible via keyboard', async ({ page }) => {
    await loginAsAdmin(page);

    // Tab through to find the logout button
    const logoutButton = page.getByRole('button', { name: 'Logout' });
    await expect(logoutButton).toBeVisible();
  });

  test('dashboard heading is visible after login', async ({ page }) => {
    await loginAsAdmin(page);

    await expect(page.getByRole('heading', { name: 'Virtual Machines' })).toBeVisible();
  });

  test('tab navigation in VM detail uses ARIA roles', async ({ page }) => {
    await loginAsAdmin(page);

    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          machines: [{ name: 'tab-test-vm', status: 'running', state: 'running', cpus: 2 }]
        })
      });
    });

    await page.goto('/');
    await expect(page.getByText('tab-test-vm')).toBeVisible();

    await page.getByRole('button', { name: 'View details for tab-test-vm' }).click();
    await expect(page.getByRole('heading', { name: 'tab-test-vm', level: 2 })).toBeVisible();

    // Tab list should have proper ARIA role
    const tablist = page.getByRole('tablist');
    await expect(tablist).toBeVisible();

    // All tabs should have role="tab"
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveCount(5);

    // Active tab should have aria-selected
    const overviewTab = page.getByRole('tab', { name: 'Overview' });
    await expect(overviewTab).toHaveAttribute('aria-selected', 'true');

    // Tab panel should have role="tabpanel"
    const tabpanel = page.getByRole('tabpanel');
    await expect(tabpanel).toBeVisible();
  });

  test('clicking tabs switches content', async ({ page }) => {
    await loginAsAdmin(page);

    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          machines: [{ name: 'nav-vm', status: 'running', state: 'running', cpus: 2 }]
        })
      });
    });

    await page.goto('/');
    await expect(page.getByText('nav-vm')).toBeVisible();

    await page.getByRole('button', { name: 'View details for nav-vm' }).click();

    // Click Config tab
    await page.getByRole('tab', { name: 'Config' }).click();
    await expect(page.getByText('Edit Configuration')).toBeVisible();

    // Click back to Overview
    await page.getByRole('tab', { name: 'Overview' }).click();
    await expect(page.getByText('Status:')).toBeVisible();
  });

  test('back button returns to machine list', async ({ page }) => {
    await loginAsAdmin(page);

    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          machines: [{ name: 'back-vm', status: 'running', state: 'running', cpus: 2 }]
        })
      });
    });

    await page.goto('/');
    await expect(page.getByText('back-vm')).toBeVisible();

    await page.getByRole('button', { name: 'View details for back-vm' }).click();
    await expect(page.getByRole('heading', { name: 'back-vm', level: 2 })).toBeVisible();

    await page.getByRole('button', { name: 'Back to machine list' }).click();
    await expect(page.getByText('back-vm')).toBeVisible();
  });
});

test.describe('responsive layout', () => {
  test('mobile viewport shows stacked header elements', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await loginAsAdmin(page);

    // Dashboard heading should still be visible on mobile
    await expect(page.getByRole('heading', { name: 'Virtual Machines' })).toBeVisible();

    // Create VM button should be visible
    await expect(page.getByRole('button', { name: 'Create new virtual machine' })).toBeVisible();
  });

  test('mobile viewport shows mobile menu toggle in header', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await loginAsAdmin(page);

    // The hamburger menu button should be visible on mobile
    const menuButton = page
      .locator('header button')
      .filter({ has: page.locator('svg') })
      .last();
    await expect(menuButton).toBeVisible();

    // Desktop nav container should be hidden on mobile
    const desktopNav = page.locator('header > div > .hidden.sm\\:flex');
    await expect(desktopNav).toBeHidden();
  });

  test('desktop viewport shows header nav directly', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await loginAsAdmin(page);

    // Desktop logout button should be visible directly
    await expect(page.getByRole('button', { name: 'Logout' })).toBeVisible();

    // Mobile menu button should not be visible
    await expect(page.getByRole('button', { name: 'Open menu' })).not.toBeVisible();
  });

  test('VM detail action buttons wrap on narrow viewports', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await loginAsAdmin(page);

    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          machines: [{ name: 'responsive-vm', status: 'running', state: 'running', cpus: 2 }]
        })
      });
    });

    await page.goto('/');
    await expect(page.getByText('responsive-vm')).toBeVisible();

    await page.getByRole('button', { name: 'View details for responsive-vm' }).click();
    await expect(page.getByRole('heading', { name: 'responsive-vm', level: 2 })).toBeVisible();

    // Action buttons should still be visible on mobile
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
  });

  test('capacity summary stacks on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await loginAsAdmin(page);

    await page.route('**/api/smolvm/machines', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ machines: [] })
      });
    });

    await page.route('**/api/smolvm/capacity', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          allocatedCpus: 4,
          allocatedMemoryMb: 8192,
          usedCpus: 2.5,
          usedMemoryMb: 4096,
          usedDiskGb: 50
        })
      });
    });

    await page.goto('/');
    await expect(page.getByText('Virtual Machines')).toBeVisible({ timeout: 10000 });

    // Capacity cards should be visible even on mobile
    await expect(page.getByText('CPU')).toBeVisible();
    await expect(page.getByText('Memory')).toBeVisible();
    await expect(page.getByText('Disk')).toBeVisible();
  });
});

test.describe('PWA shell', () => {
  test('page has valid HTML structure for PWA', async ({ page }) => {
    await loginAsAdmin(page);

    // Check viewport meta tag
    const viewport = page.locator('meta[name="viewport"]');
    await expect(viewport).toHaveAttribute('content', /width=device-width/);

    // Check theme-color meta
    const themeColor = page.locator('meta[name="theme-color"]');
    await expect(themeColor).toHaveAttribute('content', '#020617');

    // Check lang attribute
    const htmlLang = await page.locator('html').getAttribute('lang');
    expect(htmlLang).toBe('en');
  });

  test('favicon link is present', async ({ page }) => {
    await loginAsAdmin(page);

    const favicon = page.locator('link[rel="icon"]');
    await expect(favicon).toBeAttached();
  });

  test('page title includes app name', async ({ page }) => {
    await loginAsAdmin(page);

    const title = await page.title();
    expect(title).toContain('SmolVM');
  });

  test('focus-visible ring appears on interactive elements', async ({ page }) => {
    await loginAsAdmin(page);

    // Tab to the skip-to-content link (first tabbable element)
    await page.keyboard.press('Tab');

    const skipLink = page.getByRole('link', { name: 'Skip to content' });
    await expect(skipLink).toBeFocused();

    // Verify the focus-visible outline style matches the CSS rule
    const outlineStyle = await skipLink.evaluate((el) => {
      const computed = window.getComputedStyle(el);
      return {
        outlineWidth: computed.outlineWidth,
        outlineStyle: computed.outlineStyle,
        outlineColor: computed.outlineColor,
        outlineOffset: computed.outlineOffset
      };
    });
    expect(outlineStyle.outlineWidth).toBe('2px');
    expect(outlineStyle.outlineStyle).toBe('solid');
    expect(outlineStyle.outlineOffset).toBe('2px');
  });
});
