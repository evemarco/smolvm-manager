/**
 * Pylon Auth Client Abstraction
 *
 * SvelteKit delegates all auth/session state to Pylon. This module provides
 * a narrow client that documents the Pylon endpoint contracts and can be
 * mocked in environments where the Pylon CLI cannot run.
 *
 * Endpoint contracts (Pylon 0.3.333):
 * - GET    /api/auth/me             → { user_id, is_admin, roles } (session Bearer)
 * - POST   /api/auth/password/login → { token, user_id, expires_at }
 * - GET    /api/auth/session        → { session, user } (session Bearer)
 * - DELETE /api/auth/session        → void (revokes session server-side)
 * - GET    /api/entities/User       → { data: [...] } (admin Bearer only)
 * - POST   /api/entities/User       → { id } (admin Bearer; user creation)
 * - POST   /api/entities/AuditEvent → { id } (admin Bearer; audit row)
 *
 * Pylon has no sign-up endpoint: the setup flow creates the User row with the
 * admin token and an argon2id hash, then mints a session via password/login.
 * The browser-facing `pylon_session` cookie holds the Pylon session token,
 * which the manager forwards as `Authorization: Bearer` — Pylon does not read
 * cookies.
 *
 * In test environments, set PYLON_AUTH_MOCK=true to use the in-memory
 * mock implementation instead of real HTTP calls.
 */

import * as nodeCrypto from 'node:crypto';

export type PylonSession = {
  userId: string | null;
  tenantId: string | null;
  isAdmin: boolean;
  roles: string[];
};

export type PylonUser = {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
};

export type AuthOutcome =
  { success: true; user: PylonUser; setCookie?: string } | { success: false; error: string };

export interface PylonAuthClient {
  /** Probe current session from Pylon. Returns null when unauthenticated. */
  getSession(request: Request): Promise<PylonSession | null>;

  /** Sign in via Pylon email/password flow. */
  signIn(email: string, password: string, request: Request): Promise<AuthOutcome>;

  /** Sign up via Pylon email/password flow. */
  signUp(email: string, password: string, request: Request): Promise<AuthOutcome>;

  /** Sign out via Pylon. Invalidates the server-side session. */
  signOut(request: Request): Promise<{ setCookie?: string }>;

  /** Returns true when at least one User row exists in Pylon. */
  hasAdmin(): Promise<boolean>;

  /** Reset a user's password. Requires server-local context. */
  resetPassword(userId: string, newPassword: string): Promise<void>;

  /** Write an audit event into Pylon's app DB. */
  logAuditEvent(eventType: string, details?: string, ipAddress?: string): Promise<void>;

  /** Return the first admin user, or null if none exists. */
  getAdminUser(): Promise<PylonUser | null>;

  /** Return a user by ID, or null if not found. */
  getUserById(userId: string): Promise<PylonUser | null>;
}

function getPylonBaseUrl(): string {
  return process.env.PYLON_URL?.trim() || 'http://127.0.0.1:3001';
}

function extractCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1];
}

async function pylonFetchJson(
  path: string,
  init: RequestInit & { admin?: boolean; bearer?: string }
): Promise<{ status: number; body: unknown; setCookie?: string }> {
  const baseUrl = getPylonBaseUrl();
  const url = `${baseUrl}${path}`;
  const token = init.bearer ?? (init.admin ? process.env.PYLON_ADMIN_TOKEN?.trim() : undefined);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  const response = await fetch(url, {
    ...init,
    headers,
    redirect: 'manual'
  });

  const setCookie = response.headers.get('set-cookie') ?? undefined;
  let body: unknown = null;

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const text = await response.text();
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  return { status: response.status, body, setCookie };
}

async function fetchSessionUser(token: string): Promise<PylonUser | null> {
  const { status, body } = await pylonFetchJson('/api/auth/session', {
    method: 'GET',
    bearer: token
  });
  if (status !== 200 || !body || typeof body !== 'object') return null;
  const user = (body as Record<string, unknown>).user as Record<string, unknown> | undefined;
  if (!user) return null;
  return {
    id: String(user.id),
    email: String(user.email),
    name: (user.name as string) || null,
    isAdmin: Boolean(user.isAdmin)
  };
}

function buildSessionCookie(token: string, expiresAt?: number): string {
  const maxAge = expiresAt ? Math.max(0, Math.floor(expiresAt - Date.now() / 1000)) : 86400;
  return `pylon_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

async function signInWithPassword(email: string, password: string): Promise<AuthOutcome> {
  const { status, body } = await pylonFetchJson('/api/auth/password/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  if (status !== 200 || !body || typeof body !== 'object') {
    return { success: false, error: 'Invalid credentials' };
  }

  const b = body as Record<string, unknown>;
  const token = b.token as string | undefined;
  if (!token) {
    return { success: false, error: 'Invalid credentials' };
  }

  const user = await fetchSessionUser(token);
  if (!user) {
    return { success: false, error: 'Invalid credentials' };
  }

  return {
    success: true,
    user,
    setCookie: buildSessionCookie(token, b.expires_at as number | undefined)
  };
}

export function createPylonAuthClient(): PylonAuthClient {
  return {
    async getSession(request) {
      const sessionToken = extractCookie(request, 'pylon_session');
      if (!sessionToken) return null;

      const { status, body } = await pylonFetchJson('/api/auth/me', {
        method: 'GET',
        bearer: sessionToken
      });

      if (status !== 200 || !body || typeof body !== 'object') {
        return null;
      }

      const b = body as Record<string, unknown>;
      if (!b.user_id) return null;
      return {
        userId: (b.user_id as string) || null,
        tenantId: (b.tenant_id as string) || null,
        isAdmin: Boolean(b.is_admin),
        roles: Array.isArray(b.roles) ? (b.roles as string[]) : []
      };
    },

    async signIn(email, password) {
      return signInWithPassword(email, password);
    },

    async signUp(email, password) {
      const passwordHash = await hashPassword(password);
      const { status, body } = await pylonFetchJson('/api/entities/User', {
        method: 'POST',
        admin: true,
        body: JSON.stringify({ email, name: email, passwordHash, isAdmin: true })
      });

      if (status === 409) {
        return { success: false, error: 'Account already exists' };
      }
      if (status !== 200 && status !== 201) {
        const code =
          body && typeof body === 'object'
            ? (body as Record<string, Record<string, unknown>>).error?.code
            : undefined;
        if (code === 'EMAIL_TAKEN') return { success: false, error: 'Account already exists' };
        return { success: false, error: 'Signup failed' };
      }

      return signInWithPassword(email, password);
    },

    async signOut(request) {
      const sessionToken = extractCookie(request, 'pylon_session');
      if (sessionToken) {
        await pylonFetchJson('/api/auth/session', {
          method: 'DELETE',
          bearer: sessionToken
        });
      }
      return {
        setCookie: 'pylon_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
      };
    },

    async hasAdmin() {
      try {
        const { status, body } = await pylonFetchJson('/api/entities/User?limit=1', {
          method: 'GET',
          admin: true
        });
        if (status === 200 && body && typeof body === 'object') {
          const b = body as Record<string, unknown>;
          const data = b.data as unknown[] | undefined;
          return Array.isArray(data) && data.length > 0;
        }
        return true;
      } catch {
        return true;
      }
    },

    async resetPassword(userId, newPassword) {
      const { status } = await pylonFetchJson('/api/entities/User/' + userId, {
        method: 'PATCH',
        admin: true,
        body: JSON.stringify({ passwordHash: await hashPassword(newPassword) })
      });
      if (status !== 200) {
        throw new Error('Password reset failed');
      }
    },

    async logAuditEvent(eventType, details, ipAddress) {
      try {
        await pylonFetchJson('/api/entities/AuditEvent', {
          method: 'POST',
          admin: true,
          body: JSON.stringify({ eventType, details, ipAddress })
        });
      } catch {
        // Best-effort: audit logging should not break auth flows.
      }
    },

    async getAdminUser() {
      try {
        const { status, body } = await pylonFetchJson('/api/entities/User?limit=1', {
          method: 'GET',
          admin: true
        });
        if (status === 200 && body && typeof body === 'object') {
          const b = body as Record<string, unknown>;
          const data = b.data as Record<string, unknown>[] | undefined;
          if (Array.isArray(data) && data.length > 0) {
            const u = data[0];
            return {
              id: String(u.id),
              email: String(u.email),
              name: (u.name as string) || null,
              isAdmin: Boolean(u.isAdmin)
            };
          }
        }
        return null;
      } catch {
        return null;
      }
    },

    async getUserById(userId) {
      try {
        const { status, body } = await pylonFetchJson('/api/entities/User/' + userId, {
          method: 'GET',
          admin: true
        });
        if (status === 200 && body && typeof body === 'object') {
          const u = body as Record<string, unknown>;
          return {
            id: String(u.id),
            email: String(u.email),
            name: (u.name as string) || null,
            isAdmin: Boolean(u.isAdmin)
          };
        }
        return null;
      } catch {
        return null;
      }
    }
  };
}

type BunPasswordRuntime = {
  password: {
    hash(
      password: string,
      options: { algorithm: 'argon2id'; memoryCost: number; timeCost: number }
    ): Promise<string>;
  };
};

async function hashPassword(password: string): Promise<string> {
  // Pylon verifies argon2id hashes with these exact parameters (m=19456, t=2, p=1).
  // Bun exposes argon2id via Bun.password; Node 24+ via crypto.argon2Sync.
  const bun = (globalThis as { Bun?: BunPasswordRuntime }).Bun;
  if (bun) {
    return bun.password.hash(password, { algorithm: 'argon2id', memoryCost: 19456, timeCost: 2 });
  }
  const salt = nodeCrypto.randomBytes(16);
  const key = nodeCrypto.argon2Sync('argon2id', {
    message: password,
    nonce: salt,
    parallelism: 1,
    tagLength: 32,
    memory: 19456,
    passes: 2
  });
  const b64 = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=19$m=19456,t=2,p=1$${b64(salt)}$${b64(key)}`;
}

// ---------------------------------------------------------------------------
// Mock implementation for tests and environments without Pylon
// ---------------------------------------------------------------------------

type MockUser = {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  isAdmin: boolean;
};

type MockSession = {
  token: string;
  userId: string;
  expiresAt: number;
};

type MockAuditEvent = {
  eventType: string;
  details: string | null;
  ipAddress: string | null;
  createdAt: string;
};

let mockUsers: MockUser[] = [];
let mockSessions: MockSession[] = [];
let mockAuditEvents: MockAuditEvent[] = [];
let mockIdCounter = 1;

export function resetMockPylonAuth(): void {
  mockUsers = [];
  mockSessions = [];
  mockAuditEvents = [];
  mockIdCounter = 1;
}

export function createMockPylonAuthClient(): PylonAuthClient {
  return {
    async getSession(request) {
      const cookie = extractCookie(request, 'pylon_session');
      if (!cookie) return null;

      const session = mockSessions.find((s) => s.token === cookie);
      if (!session || session.expiresAt < Date.now()) return null;

      const user = mockUsers.find((u) => u.id === session.userId);
      if (!user) return null;

      return {
        userId: user.id,
        tenantId: null,
        isAdmin: user.isAdmin,
        roles: user.isAdmin ? ['admin'] : []
      };
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async signIn(email, password, _request: Request) {
      const user = mockUsers.find((u) => u.email === email);
      if (!user) {
        return { success: false, error: 'Invalid credentials' };
      }

      const valid = await Bun.password.verify(password, user.passwordHash);
      if (!valid) {
        return { success: false, error: 'Invalid credentials' };
      }

      const token = crypto.randomUUID();
      mockSessions.push({
        token,
        userId: user.id,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
      });

      return {
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: user.isAdmin
        },
        setCookie: `pylon_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
      };
    },

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async signUp(email, password, _request: Request) {
      if (mockUsers.some((u) => u.email === email)) {
        return { success: false, error: 'Account already exists' };
      }

      const id = String(mockIdCounter++);
      const passwordHash = await hashPassword(password);
      mockUsers.push({
        id,
        email,
        name: email,
        passwordHash,
        isAdmin: true
      });

      const token = crypto.randomUUID();
      mockSessions.push({
        token,
        userId: id,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
      });

      return {
        success: true,
        user: {
          id,
          email,
          name: email,
          isAdmin: true
        },
        setCookie: `pylon_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`
      };
    },

    async signOut(request) {
      const cookie = extractCookie(request, 'pylon_session');
      if (cookie) {
        mockSessions = mockSessions.filter((s) => s.token !== cookie);
      }
      return {
        setCookie: 'pylon_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
      };
    },

    async hasAdmin() {
      return mockUsers.length > 0;
    },

    async resetPassword(userId, newPassword) {
      const user = mockUsers.find((u) => u.id === userId);
      if (!user) throw new Error('User not found');
      user.passwordHash = await hashPassword(newPassword);
      mockSessions = mockSessions.filter((s) => s.userId !== userId);
    },

    async logAuditEvent(eventType, details, ipAddress) {
      mockAuditEvents.push({
        eventType,
        details: details ?? null,
        ipAddress: ipAddress ?? null,
        createdAt: new Date().toISOString()
      });
    },

    async getAdminUser() {
      const user = mockUsers.find((u) => u.isAdmin);
      if (!user) return null;
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin
      };
    },

    async getUserById(userId) {
      const user = mockUsers.find((u) => u.id === userId);
      if (!user) return null;
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        isAdmin: user.isAdmin
      };
    }
  };
}

export function getPylonAuthClient(): PylonAuthClient {
  if (process.env.PYLON_AUTH_MOCK === 'true') {
    return createMockPylonAuthClient();
  }
  return createPylonAuthClient();
}

export function getMockAuditEvents(): MockAuditEvent[] {
  return [...mockAuditEvents];
}

export function getMockUsers(): MockUser[] {
  return [...mockUsers];
}

export function getMockSessions(): MockSession[] {
  return [...mockSessions];
}

export async function createMockUser(
  email: string,
  password: string,
  isAdmin: boolean
): Promise<PylonUser> {
  const id = String(mockIdCounter++);
  const passwordHash = await hashPassword(password);
  mockUsers.push({
    id,
    email,
    name: email,
    passwordHash,
    isAdmin
  });
  return { id, email, name: email, isAdmin };
}

export function generateCsrfToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
