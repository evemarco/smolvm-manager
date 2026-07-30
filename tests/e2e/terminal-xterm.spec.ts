import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __xtermFrames: string[];
    __xtermBinarySent: boolean;
  }
}

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

async function mockMachines(page: Page) {
  await page.route('**/api/smolvm/machines/stream', async () => {
    await new Promise<void>(() => undefined);
  });
  await page.route('**/api/smolvm/machines', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        machines: [{ name: 'stream-vm', status: 'running', state: 'running', cpus: 2 }]
      })
    });
  });
}

async function openStreamVmDetail(page: Page) {
  await mockMachines(page);
  await loginAsAdmin(page);
  await expect(page.getByText('stream-vm')).toBeVisible();
  await page.getByRole('button', { name: 'View details for stream-vm' }).click();
  await expect(page.getByRole('heading', { name: 'stream-vm', level: 2 })).toBeVisible();
}

function installFakeWebSocket(page: Page) {
  return page.addInitScript(() => {
    class FakeWebSocket extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      binaryType: 'arraybuffer' | 'blob' = 'arraybuffer';
      readyState = FakeWebSocket.CONNECTING;
      url: string;

      constructor(url: string) {
        super();
        this.url = url;
        window.__xtermFrames = [];
        window.__xtermBinarySent = false;

        setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.dispatchEvent(new Event('open'));

          // Send binary stdout frame (simulates PTY output) after a delay
          // to allow terminal renderer initialization
          setTimeout(() => {
            const stdoutBytes = new TextEncoder().encode('hello from pty\r\n');
            this.dispatchEvent(new MessageEvent('message', { data: stdoutBytes.buffer.slice(0) }));
          }, 50);
        }, 50);
      }

      send(data: string | ArrayBuffer) {
        if (typeof data === 'string') {
          window.__xtermFrames.push(data);
        }
      }

      close(code = 1000, reason = '') {
        this.readyState = FakeWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent('close', { code, reason }));
      }
    }

    window.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
  });
}

test.describe('xterm.js terminal', () => {
  test('renders xterm terminal, writes stdout, sends stdin and resize frames', async ({ page }) => {
    await installFakeWebSocket(page);
    await openStreamVmDetail(page);
    await page.getByRole('tab', { name: 'Terminal' }).click();

    // Confirmation gate still present
    await expect(page.getByText('authenticated manager proxy')).toBeVisible();
    await page.getByRole('button', { name: 'I understand, open terminal' }).click();

    // Status pill transitions to Connected
    await expect(page.getByText('Connected', { exact: true })).toBeVisible();

    // xterm.js DOM renders
    const xtermRoot = page.locator('.xterm');
    await expect(xtermRoot).toBeVisible({ timeout: 10000 });

    // Binary stdout bytes appear in xterm-rows
    const rows = page.locator('.xterm-rows');
    await expect(rows).toContainText('hello from pty', { timeout: 5000 });

    const helperTextarea = page.locator('.xterm-helper-textarea');
    await helperTextarea.focus();

    await page.evaluate(() => {
      const term = (window as unknown as Record<string, unknown>).__xtermTerm as {
        paste: (data: string) => void;
      };
      term.paste('ls');
    });
    await page.waitForTimeout(200);

    const framesAfterType = await page.evaluate(() => window.__xtermFrames);

    const hasStdinFrame = framesAfterType.some((f) => f.includes('"stdin"') && f.includes('ls'));
    expect(hasStdinFrame).toBe(true);

    // Trigger a resize by changing the container dimensions
    await page.evaluate(() => {
      const container = document.querySelector<HTMLElement>('[data-testid="xterm-container"]');
      if (container) {
        container.style.width = '1200px';
        container.style.height = '600px';
      }
    });

    // Wait for ResizeObserver + fitAddon.fit() + sendFrame
    await page.waitForTimeout(200);

    const framesAfterResize = await page.evaluate(() => window.__xtermFrames);
    const hasResizeFrame = framesAfterResize.some((f) => f.includes('"resize"'));
    expect(hasResizeFrame).toBe(true);

    // Validate resize frame has cols and rows
    const resizeFrame = framesAfterResize.find((f) => f.includes('"resize"'));
    expect(resizeFrame).toBeDefined();
    const parsed = JSON.parse(resizeFrame!);
    expect(parsed.cols).toBeGreaterThan(0);
    expect(parsed.rows).toBeGreaterThan(0);

    // Close the terminal — sends close frame
    await page.getByRole('button', { name: 'Close terminal' }).click();
    await expect(page.getByText('Closed', { exact: true })).toBeVisible();
  });
});
