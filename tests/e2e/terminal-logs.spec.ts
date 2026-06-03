import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __terminalFrames: string[];
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

test.describe('logs and terminal tabs', () => {
  test('terminal websocket rejects unauthenticated browser attempts', async ({ page }) => {
    await page.goto('/login');

    const result = await page.evaluate(async () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}/api/smolvm/machines/stream-vm/terminal/ws`;
      return await new Promise<string>((resolve) => {
        const ws = new WebSocket(url);
        ws.addEventListener('open', () => resolve('opened'));
        ws.addEventListener('error', () => resolve('error'));
        ws.addEventListener('close', () => resolve('closed'));
        setTimeout(() => resolve('timeout'), 3000);
      });
    });

    expect(result).not.toBe('opened');
  });

  test('logs tab loads bounded tail and shows reconnect state when stream closes', async ({
    page
  }) => {
    let requestedUrl = '';
    await page.route('**/api/smolvm/machines/stream-vm/logs?**', async (route) => {
      requestedUrl = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Cache-Control': 'no-store' },
        body:
          'event: ready\ndata: {"tail":200,"follow":true}\n\n' +
          'event: log\ndata: {"line":"boot ok"}\n\n' +
          'event: log\ndata: {"line":"service ready"}\n\n'
      });
    });

    await openStreamVmDetail(page);
    await page.getByRole('tab', { name: 'Logs' }).click();

    await expect(page.getByText('Loading the last 200 lines')).toBeVisible();
    await expect(page.getByLabel('Log output')).toContainText('boot ok');
    await expect(page.getByLabel('Log output')).toContainText('service ready');
    await expect.poll(() => requestedUrl).toContain('tail=200');
    await expect(page.getByText('Reconnecting', { exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('terminal tab confirms open, sends input and resize, and receives output', async ({
    page
  }) => {
    await page.addInitScript(() => {
      class FakeWebSocket extends EventTarget {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        binaryType = 'blob';
        readyState = FakeWebSocket.CONNECTING;
        url: string;

        constructor(url: string) {
          super();
          this.url = url;
          window.__terminalFrames = [];
          setTimeout(() => {
            this.readyState = FakeWebSocket.OPEN;
            this.dispatchEvent(new Event('open'));
            this.dispatchEvent(
              new MessageEvent('message', { data: new TextEncoder().encode('ready\n').buffer })
            );
          }, 20);
        }

        send(data: string) {
          window.__terminalFrames.push(data);
          if (data.includes('status')) {
            this.dispatchEvent(
              new MessageEvent('message', { data: new TextEncoder().encode('ok\n').buffer })
            );
          }
        }

        close(code = 1000, reason = '') {
          this.readyState = FakeWebSocket.CLOSED;
          this.dispatchEvent(new CloseEvent('close', { code, reason }));
        }
      }

      window.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    });

    await openStreamVmDetail(page);
    await page.getByRole('tab', { name: 'Terminal' }).click();

    await expect(page.getByText('authenticated manager proxy')).toBeVisible();
    await page.getByRole('button', { name: 'I understand, open terminal' }).click();

    await expect(page.getByText('Connected', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Terminal output')).toContainText('Terminal session opened.');
    await expect(page.getByLabel('Terminal output')).toContainText('ready');

    await page.getByLabel('Terminal columns').fill('120');
    await page.getByLabel('Terminal rows').fill('40');
    await page.getByPlaceholder('Type a command...').fill('status');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByLabel('Terminal output')).toContainText('ok');
    const frames = await page.evaluate(() => window.__terminalFrames);
    expect(frames.some((frame) => frame.includes('"resize"'))).toBe(true);
    expect(frames.some((frame) => frame.includes('"stdin"') && frame.includes('status'))).toBe(
      true
    );

    await page.getByRole('button', { name: 'Close terminal' }).click();
    await expect(page.getByText('Closed', { exact: true })).toBeVisible();
  });
});
