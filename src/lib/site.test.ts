import { expect, test } from 'bun:test';

import { appName, appSubtitle } from './site';

test('site copy stays stable', () => {
  expect(appName).toBe('SmolVM Manager');
  expect(appSubtitle).toContain('LAN/Tailscale');
});
