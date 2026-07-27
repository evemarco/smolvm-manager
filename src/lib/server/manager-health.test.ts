import { expect, test } from 'bun:test';
import { createSmolVmClient, type SmolVmTransport } from './smolvm-client';
import { createManagerHealth } from './manager-health';

function healthTransport(handler: (path: string) => { status: number; body: string }): SmolVmTransport {
  return async (_socketPath, options) => {
    const result = handler(options.path);
    return { status: result.status, headers: {}, body: result.body };
  };
}

test('manager health reports commit, build time and SmolVM version', async () => {
  const client = createSmolVmClient({
    transport: healthTransport(() => ({
      status: 200,
      body: JSON.stringify({ status: 'ok', version: '1.7.0' })
    }))
  });

  const health = await createManagerHealth(client);
  expect(health.commit).toBeString();
  expect(health.buildTime).toBeString();
  expect(health.smolvm).toEqual({ reachable: true, version: '1.7.0' });
});

test('manager health reports SmolVM as unreachable instead of failing', async () => {
  const client = createSmolVmClient({
    transport: healthTransport(() => {
      throw new Error('socket missing');
    })
  });

  const health = await createManagerHealth(client);
  expect(health.smolvm).toEqual({ reachable: false, version: null });
});
