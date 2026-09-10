import type { Page } from '@playwright/test';

export type MockMachine = Record<string, unknown>;

/**
 * Hermetic SmolVM machine list for E2E tests.
 *
 * The dashboard reads machines from BOTH `GET /api/smolvm/machines` and the
 * SSE stream at `/api/smolvm/machines/stream` — the stream's snapshot
 * wholesale replaces the list. Mocking only the GET route is not enough: on a
 * host with real VMs, the live stream overwrites the mock with real machines.
 *
 * Both routes are served from one mutable state so fetch and stream always
 * agree. `retry: 600000` keeps native EventSource reconnects out of the test
 * window after the first snapshot.
 */
export type SmolVmMachineMock = {
  setMachines(machines: MockMachine[]): void;
};

function sseSnapshot(machines: MockMachine[]): string {
  return 'retry: 600000\n' + `event: snapshot\ndata: ${JSON.stringify({ machines })}\n\n`;
}

export async function mockSmolVmMachines(
  page: Page,
  machines: MockMachine[] = []
): Promise<SmolVmMachineMock> {
  const state: { machines: MockMachine[] } = { machines };

  await page.route('**/api/smolvm/machines', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ machines: state.machines })
    });
  });

  await page.route('**/api/smolvm/machines/stream', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      headers: { 'cache-control': 'no-cache' },
      body: sseSnapshot(state.machines)
    });
  });

  return {
    setMachines(next: MockMachine[]) {
      state.machines = next;
    }
  };
}
