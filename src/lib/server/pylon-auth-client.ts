/**
 * Pylon Auth Client Abstraction
 *
 * SvelteKit delegates all auth/session state to Pylon. This module provides
 * a narrow client that documents the Pylon endpoint contracts and can be
 * mocked in environments where the Pylon CLI cannot run.
 *
 * Endpoint contracts (to be verified against a live Pylon instance):
 * - GET  /api/auth/me              → { user_id, tenant_id, is_admin, roles }
 * - POST /api/auth/sign-in/email   → { token, user: { id, email, name, ... } }
 * - POST /api/auth/sign-up/email   → { token, user: { id, email, name, ... } }
 * - POST /api/auth/sign-out        → void (clears session cookie)
 * - DELETE /api/auth/session       → void (revokes session server-side)
 * - GET  /api/entities/User        → [{ id, email, name, isAdmin, ... }]
 * - POST /api/entities/AuditEvent  → { id } (creates audit row)
 *
 * In test environments, set PYLON_AUTH_MOCK=true to use the in-memory
 * mock implementation instead of real HTTP calls.
 */

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
  | { success: true; user: PylonUser; setCookie?: string }
  | { success: false; error: string };

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

function buildCookieHeader(request: Request): string | undefined {
  return request.headers.get('cookie') ?? undefined;
}

async function pylonFetchJson(
  path: string,
  init: RequestInit & { cookie?: string }
): Promise<{ status: number; body: unknown; setCookie?: string }> {
  const baseUrl = getPylonBaseUrl();
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(init.cookie ? { Cookie: init.cookie } : {})
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

export function createPylonAuthClient(): PylonAuthClient {
  return {
    async getSession(request) {
      const cookie = buildCookieHeader(request);
      const { status, body } = await pylonFetchJson('/api/auth/me', {
        method: 'GET',
        cookie
      });

      if (status !== 200 || !body || typeof body !== 'object') {
        return null;
      }

      const b = body as Record<string, unknown>;
      return {
        userId: (b.user_id as string) || null,
        tenantId: (b.tenant_id as string) || null,
        isAdmin: Boolean(b.is_admin),
        roles: Array.isArray(b.roles) ? (b.roles as string[]) : []
      };
    },

    async signIn(email, password, request: Request) {
      const cookie = buildCookieHeader(request);
      const { status, body, setCookie } = await pylonFetchJson('/api/auth/sign-in/email', {
        method: 'POST',
        cookie,
        body: JSON.stringify({ email, password })
      });

      if (status !== 200 || !body || typeof body !== 'object') {
        return { success: false, error: 'Invalid credentials' };
      }

      const b = body as Record<string, unknown>;
      const user = b.user as Record<string, unknown> | undefined;
      if (!user) {
        return { success: false, error: 'Invalid credentials' };
      }

      return {
        success: true,
        user: {
          id: String(user.id),
          email: String(user.email),
          name: (user.name as string) || null,
          isAdmin: Boolean(user.isAdmin)
        },
        setCookie
      };
    },

    async signUp(email, password, request: Request) {
      const cookie = buildCookieHeader(request);
      const { status, body, setCookie } = await pylonFetchJson('/api/auth/sign-up/email', {
        method: 'POST',
        cookie,
        body: JSON.stringify({ email, password, name: email })
      });

      if (status !== 200 || !body || typeof body !== 'object') {
        return { success: false, error: 'Signup failed' };
      }

      const b = body as Record<string, unknown>;
      const user = b.user as Record<string, unknown> | undefined;
      if (!user) {
        return { success: false, error: 'Signup failed' };
      }

      return {
        success: true,
        user: {
          id: String(user.id),
          email: String(user.email),
          name: (user.name as string) || null,
          isAdmin: Boolean(user.isAdmin)
        },
        setCookie
      };
    },

    async signOut(request) {
      const cookie = buildCookieHeader(request);
      const { setCookie } = await pylonFetchJson('/api/auth/sign-out', {
        method: 'POST',
        cookie
      });
      return { setCookie };
    },

    async hasAdmin() {
      try {
        const { status, body } = await pylonFetchJson('/api/entities/User?limit=1', {
          method: 'GET'
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
          body: JSON.stringify({ eventType, details, ipAddress })
        });
      } catch {
        // Best-effort: audit logging should not break auth flows.
      }
    },

    async getAdminUser() {
      try {
        const { status, body } = await pylonFetchJson('/api/entities/User?limit=1', {
          method: 'GET'
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
          method: 'GET'
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

async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: 'bcrypt', cost: 12 });
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

export function generateCsrfToken(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
