import { expect, test, beforeEach } from 'bun:test';
import {
  createMockPylonAuthClient,
  createMockUser,
  resetMockPylonAuth,
  getMockAuditEvents,
  getMockUsers,
  getMockSessions,
  generateCsrfToken
} from './pylon-auth-client';

beforeEach(() => {
  resetMockPylonAuth();
});

test('generateCsrfToken produces unique tokens', () => {
  const t1 = generateCsrfToken();
  const t2 = generateCsrfToken();
  expect(t1).not.toBe(t2);
  expect(t1.length).toBe(32);
});

test('mock hasAdmin returns false when no users exist', async () => {
  const client = createMockPylonAuthClient();
  expect(await client.hasAdmin()).toBe(false);
});

test('mock signUp creates admin and returns session cookie', async () => {
  const client = createMockPylonAuthClient();
  const result = await client.signUp('admin', 'securepass123', new Request('http://localhost'));

  expect(result.success).toBe(true);
  if (!result.success) return;

  expect(result.user.email).toBe('admin');
  expect(result.user.isAdmin).toBe(true);
  expect(result.setCookie).toContain('pylon_session=');

  expect(await client.hasAdmin()).toBe(true);
  expect(getMockUsers()).toHaveLength(1);
});

test('mock signUp fails when user already exists', async () => {
  const client = createMockPylonAuthClient();
  await client.signUp('admin', 'securepass123', new Request('http://localhost'));
  const result = await client.signUp('admin', 'anotherpass123', new Request('http://localhost'));

  if (result.success) throw new Error('Expected signup to fail');
  expect(result.error).toContain('already exists');
});

test('mock signIn with valid credentials', async () => {
  const client = createMockPylonAuthClient();
  await client.signUp('admin', 'securepass123', new Request('http://localhost'));

  const result = await client.signIn('admin', 'securepass123', new Request('http://localhost'));
  expect(result.success).toBe(true);
  if (!result.success) return;

  expect(result.user.email).toBe('admin');
  expect(result.setCookie).toContain('pylon_session=');
});

test('mock signIn with invalid credentials fails', async () => {
  const client = createMockPylonAuthClient();
  await client.signUp('admin', 'securepass123', new Request('http://localhost'));

  const result = await client.signIn('admin', 'wrongpass', new Request('http://localhost'));
  if (result.success) throw new Error('Expected signin to fail');
  expect(result.error).toContain('Invalid');
});

test('mock getSession returns authenticated user with valid cookie', async () => {
  const client = createMockPylonAuthClient();
  const signup = await client.signUp('admin', 'securepass123', new Request('http://localhost'));
  expect(signup.success).toBe(true);
  if (!signup.success) return;

  const cookie = signup.setCookie!;
  const sessionToken = cookie.match(/pylon_session=([^;]+)/)![1];

  const request = new Request('http://localhost', {
    headers: { Cookie: `pylon_session=${sessionToken}` }
  });

  const session = await client.getSession(request);
  expect(session).not.toBeNull();
  expect(session!.userId).toBe(signup.user.id);
  expect(session!.isAdmin).toBe(true);
});

test('mock getSession returns null for expired session', async () => {
  const client = createMockPylonAuthClient();
  const signup = await client.signUp('admin', 'securepass123', new Request('http://localhost'));
  expect(signup.success).toBe(true);
  if (!signup.success) return;

  // Manually expire the session
  const sessions = getMockSessions();
  sessions[0].expiresAt = Date.now() - 1000;

  const cookie = signup.setCookie!;
  const sessionToken = cookie.match(/pylon_session=([^;]+)/)![1];
  const request = new Request('http://localhost', {
    headers: { Cookie: `pylon_session=${sessionToken}` }
  });

  const session = await client.getSession(request);
  expect(session).toBeNull();
});

test('mock signOut clears session', async () => {
  const client = createMockPylonAuthClient();
  const signup = await client.signUp('admin', 'securepass123', new Request('http://localhost'));
  expect(signup.success).toBe(true);
  if (!signup.success) return;

  const cookie = signup.setCookie!;
  const sessionToken = cookie.match(/pylon_session=([^;]+)/)![1];
  const request = new Request('http://localhost', {
    headers: { Cookie: `pylon_session=${sessionToken}` }
  });

  await client.signOut(request);
  expect(getMockSessions()).toHaveLength(0);
});

test('mock resetPassword changes password and invalidates sessions', async () => {
  const client = createMockPylonAuthClient();
  const signup = await client.signUp('admin', 'oldpass123', new Request('http://localhost'));
  expect(signup.success).toBe(true);
  if (!signup.success) return;

  // Create a session (signup already created one, so now there are 2)
  await client.signIn('admin', 'oldpass123', new Request('http://localhost'));
  expect(getMockSessions()).toHaveLength(2);

  await client.resetPassword(signup.user.id, 'newpass123');

  // Old password should fail
  const oldLogin = await client.signIn('admin', 'oldpass123', new Request('http://localhost'));
  expect(oldLogin.success).toBe(false);

  // New password should work
  const newLogin = await client.signIn('admin', 'newpass123', new Request('http://localhost'));
  expect(newLogin.success).toBe(true);

  // Sessions should have been invalidated
  expect(getMockSessions()).toHaveLength(1); // only the new login session
});

test('mock logAuditEvent records events', async () => {
  const client = createMockPylonAuthClient();
  await client.logAuditEvent('setup', 'Admin created', '127.0.0.1');
  await client.logAuditEvent('login', 'Admin logged in', '127.0.0.1');

  const events = getMockAuditEvents();
  expect(events.length).toBe(2);
  expect(events[0].eventType).toBe('setup');
  expect(events[1].eventType).toBe('login');
});

test('mock getAdminUser returns first admin', async () => {
  const client = createMockPylonAuthClient();
  expect(await client.getAdminUser()).toBeNull();

  const signup = await client.signUp('admin', 'securepass123', new Request('http://localhost'));
  expect(signup.success).toBe(true);

  const admin = await client.getAdminUser();
  expect(admin).not.toBeNull();
  expect(admin!.email).toBe('admin');
  expect(admin!.isAdmin).toBe(true);
});

test('mock admin session has isAdmin true and admin role', async () => {
  const client = createMockPylonAuthClient();
  const signup = await client.signUp('admin', 'securepass123', new Request('http://localhost'));
  expect(signup.success).toBe(true);
  if (!signup.success) return;

  const cookie = signup.setCookie!;
  const sessionToken = cookie.match(/pylon_session=([^;]+)/)![1];
  const request = new Request('http://localhost', {
    headers: { Cookie: `pylon_session=${sessionToken}` }
  });

  const session = await client.getSession(request);
  expect(session).not.toBeNull();
  expect(session!.isAdmin).toBe(true);
  expect(session!.roles).toContain('admin');
});

test('mock non-admin session has isAdmin false and no admin role', async () => {
  const client = createMockPylonAuthClient();
  await createMockUser('user@example.com', 'userpass123', false);

  const result = await client.signIn(
    'user@example.com',
    'userpass123',
    new Request('http://localhost')
  );
  expect(result.success).toBe(true);
  if (!result.success) return;

  const cookie = result.setCookie!;
  const sessionToken = cookie.match(/pylon_session=([^;]+)/)![1];
  const request = new Request('http://localhost', {
    headers: { Cookie: `pylon_session=${sessionToken}` }
  });

  const session = await client.getSession(request);
  expect(session).not.toBeNull();
  expect(session!.isAdmin).toBe(false);
  expect(session!.roles).not.toContain('admin');
  expect(session!.userId).toBe(result.user.id);
});

test('mock non-admin is denied admin-only metadata access via session', async () => {
  const client = createMockPylonAuthClient();
  await createMockUser('user@example.com', 'userpass123', false);

  const result = await client.signIn(
    'user@example.com',
    'userpass123',
    new Request('http://localhost')
  );
  expect(result.success).toBe(true);
  if (!result.success) return;

  const cookie = result.setCookie!;
  const sessionToken = cookie.match(/pylon_session=([^;]+)/)![1];
  const request = new Request('http://localhost', {
    headers: { Cookie: `pylon_session=${sessionToken}` }
  });

  const session = await client.getSession(request);
  expect(session).not.toBeNull();
  expect(session!.isAdmin).toBe(false);
  expect(await client.getAdminUser()).toBeNull();
});
