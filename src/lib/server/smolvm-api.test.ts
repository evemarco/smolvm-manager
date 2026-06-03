import { expect, test, describe } from 'bun:test';
import {
  smolVmJson,
  smolVmErrorResponse,
  unauthorizedSmolVmResponse,
  placeholderStatus,
  requireSmolVmAdmin
} from './smolvm-api';
import { SMOLVM_ERROR_CODES, SmolVmError, createSmolVmClient } from './smolvm-client';

describe('smolvm-api facade', () => {
  test('smolVmJson returns Response with JSON body', async () => {
    const response = smolVmJson({ status: 'ok' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  test('smolVmJson respects custom status', async () => {
    const response = smolVmJson({ created: true }, { status: 201 });
    expect(response.status).toBe(201);
  });

  test('smolVmErrorResponse normalizes SmolVmError to JSON Response', async () => {
    const error = new SmolVmError(SMOLVM_ERROR_CODES.UNREACHABLE, 'Down', 503);
    const response = smolVmErrorResponse(error);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: SMOLVM_ERROR_CODES.UNREACHABLE,
      message: 'Down',
      status: 503
    });
  });

  test('smolVmErrorResponse normalizes generic Error to bad response', async () => {
    const response = smolVmErrorResponse(new Error('something broke'));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.code).toBe(SMOLVM_ERROR_CODES.BAD_RESPONSE);
    expect(body.status).toBe(502);
  });

  test('unauthorizedSmolVmResponse returns 401', async () => {
    const response = unauthorizedSmolVmResponse();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  test('placeholderStatus returns 501', async () => {
    const response = placeholderStatus({
      available: false,
      feature: 'images',
      message: 'Not implemented'
    });
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      available: false,
      feature: 'images',
      message: 'Not implemented'
    });
  });

  test('requireSmolVmAdmin returns 401 when admin is missing', async () => {
    const response = await requireSmolVmAdmin({ locals: {} }, async () => 'should-not-run');
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'Unauthorized' });
  });

  test('requireSmolVmAdmin calls handler and returns 200 JSON when authenticated', async () => {
    const client = createSmolVmClient({
      transport: async () => ({
        status: 200,
        headers: {},
        body: JSON.stringify({ status: 'ok' })
      })
    });
    const response = await requireSmolVmAdmin(
      { locals: { admin: { id: '1', email: 'a', name: null } }, client },
      async (c) => c.getHealth()
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  test('requireSmolVmAdmin catches handler errors and returns normalized response', async () => {
    const response = await requireSmolVmAdmin(
      { locals: { admin: { id: '1', email: 'a', name: null } } },
      async () => {
        throw new SmolVmError(SMOLVM_ERROR_CODES.BAD_RESPONSE, 'Bad', 502);
      }
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      code: SMOLVM_ERROR_CODES.BAD_RESPONSE,
      message: 'Bad',
      status: 502
    });
  });
});
