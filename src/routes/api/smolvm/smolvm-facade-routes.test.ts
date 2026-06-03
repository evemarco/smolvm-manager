import { describe, expect, test } from 'bun:test';
import { GET as getImages } from './images/+server';
import { GET as getManagerUpdate } from './update/+server';
import { PATCH as patchMachineUpdate } from './machines/[name]/update/+server';

const admin = { id: 'admin-1', email: 'admin@example.com', name: null };

describe('SmolVM facade routes', () => {
  test('global images route requires an explicit machine instead of returning a placeholder', async () => {
    const response = await getImages({
      locals: { admin },
      url: new URL('http://local/api/smolvm/images')
    } as Parameters<typeof getImages>[0]);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      available: false,
      feature: 'images',
      code: 'SMOLVM_MACHINE_REQUIRED',
      message: 'SmolVM 0.8.1 exposes image cache operations per machine. Supply ?machine=<name>.'
    });
  });

  test('manager update route is authenticated and documents deployment upgrade fallback', async () => {
    const response = await getManagerUpdate({ locals: { admin } } as Parameters<
      typeof getManagerUpdate
    >[0]);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      available: false,
      feature: 'managerUpdate',
      code: 'SMOLVM_MANAGER_UPDATE_UNAVAILABLE',
      message:
        'SmolVM 0.8.1 does not expose a server update endpoint. Upgrade the manager and SmolVM through the deployment process.'
    });
  });

  test('machine update route enforces recreate-required path with 409', async () => {
    const response = await patchMachineUpdate({
      locals: { admin },
      params: { name: 'vm one' }
    } as Parameters<typeof patchMachineUpdate>[0]);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      available: false,
      feature: 'machineUpdate',
      code: 'SMOLVM_RECREATE_REQUIRED',
      machine: 'vm one',
      message:
        'SmolVM 0.8.1 does not expose a general live machine update API. Use the recreate endpoint for configuration changes.',
      recreateEndpoint: '/api/smolvm/machines/vm%20one/recreate'
    });
  });

  test('machine update route rejects unauthenticated requests before fallback details', async () => {
    const response = await patchMachineUpdate({
      locals: {},
      params: { name: 'vm one' }
    } as Parameters<typeof patchMachineUpdate>[0]);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });
});
