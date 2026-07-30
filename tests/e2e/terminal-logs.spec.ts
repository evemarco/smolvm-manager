import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __terminalFrames: string[];
    __terminalConnections: string[];
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

async function mockMachines(
  page: Page,
  machines: Array<Record<string, unknown>> = [
    { name: 'stream-vm', status: 'running', state: 'running', cpus: 2 }
  ]
) {
  await page.route('**/api/smolvm/machines/stream', async () => {
    await new Promise<void>(() => undefined);
  });
  await page.route('**/api/smolvm/machines', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        machines
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
    await page.getByRole('tab', { name: 'Logs', exact: true }).click();

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
        binaryType = 'arraybuffer';
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
    const xtermRoot = page.locator('.xterm');
    await expect(xtermRoot).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.xterm-rows')).toContainText('ready', { timeout: 5000 });

    await page.evaluate(() => {
      const term = (window as unknown as Record<string, unknown>).__xtermTerm as {
        paste: (data: string) => void;
      };
      term.paste('status');
    });
    await page.waitForTimeout(200);

    await expect(page.locator('.xterm-rows')).toContainText('ok', { timeout: 5000 });
    const frames = await page.evaluate(() => window.__terminalFrames);
    expect(frames.some((frame) => frame.includes('"resize"'))).toBe(true);
    expect(frames.some((frame) => frame.includes('"stdin"') && frame.includes('status'))).toBe(
      true
    );

    await page.getByRole('button', { name: 'Close terminal' }).click();
    await expect(page.getByText('Closed', { exact: true })).toBeVisible();
  });

  test('terminal session persists across tab and VM navigation', async ({ page }) => {
    await page.addInitScript(() => {
      window.__terminalConnections = [];

      class FakeWebSocket extends EventTarget {
        static CONNECTING = 0;
        static OPEN = 1;
        static CLOSING = 2;
        static CLOSED = 3;
        binaryType: 'arraybuffer' | 'blob' = 'arraybuffer';
        readyState = FakeWebSocket.CONNECTING;

        constructor(readonly url: string) {
          super();
          if (url.includes('/terminal/ws')) window.__terminalConnections.push(url);
          const machineName = url.includes('second-vm') ? 'second-vm' : 'stream-vm';
          setTimeout(() => {
            this.readyState = FakeWebSocket.OPEN;
            this.dispatchEvent(new Event('open'));
            this.dispatchEvent(
              new MessageEvent('message', {
                data: new TextEncoder().encode(`session:${machineName}\r\n`).buffer
              })
            );
          }, 20);
        }

        send() {}

        close(code = 1000, reason = '') {
          this.readyState = FakeWebSocket.CLOSED;
          this.dispatchEvent(new CloseEvent('close', { code, reason }));
        }
      }

      window.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    });

    await mockMachines(page, [
      { name: 'stream-vm', status: 'running', state: 'running', cpus: 2 },
      { name: 'second-vm', status: 'running', state: 'running', cpus: 1 }
    ]);
    await loginAsAdmin(page);

    await page.getByRole('button', { name: 'View details for stream-vm' }).click();
    await page.getByRole('tab', { name: 'Terminal' }).click();
    await page.getByRole('button', { name: 'I understand, open terminal' }).click();
    await expect(page.locator('.xterm-rows')).toContainText('session:stream-vm');

    await page.getByRole('tab', { name: 'Overview' }).click();
    await page.getByRole('tab', { name: 'Terminal' }).click();
    await expect(page.locator('.xterm-rows')).toContainText('session:stream-vm');
    await expect(page.getByRole('button', { name: 'I understand, open terminal' })).toBeHidden();

    await page.getByRole('button', { name: 'Back to machine list' }).click();
    await page.getByRole('button', { name: 'View details for second-vm' }).click();
    await page.getByRole('tab', { name: 'Terminal' }).click();
    await page.getByRole('button', { name: 'I understand, open terminal' }).click();
    await expect(page.locator('.xterm-rows')).toContainText('session:second-vm');

    await page.getByRole('button', { name: 'Back to machine list' }).click();
    await page.getByRole('button', { name: 'View details for stream-vm' }).click();
    await page.getByRole('tab', { name: 'Terminal' }).click();
    await expect(page.locator('.xterm-rows')).toContainText('session:stream-vm');
    await expect
      .poll(() => page.evaluate(() => window.__terminalConnections.length))
      .toBe(2);
  });
});
