import { redirect, type Handle } from '@sveltejs/kit';
import { getPylonAuthClient, generateCsrfToken } from '$lib/server/pylon-auth-client';
import { startMetricsSampler } from '$lib/server/metrics-sampler';

startMetricsSampler();

const PUBLIC_ROUTES = new Set(['/login', '/setup', '/offline']);
const PUBLIC_API_PREFIXES = ['/api/public'];
const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

function isPublicPath(path: string): boolean {
  if (PUBLIC_ROUTES.has(path)) return true;
  return PUBLIC_API_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function isApiPath(path: string): boolean {
  return path.startsWith('/api/');
}

function getOrigin(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function validateOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;

  const expectedOrigin = getOrigin(request);
  return origin === expectedOrigin;
}

function isSecureContext(request: Request): boolean {
  const url = new URL(request.url);
  return url.protocol === 'https:' || process.env.FORCE_SECURE_COOKIES === 'true';
}

export const handle: Handle = async ({ event, resolve }) => {
  const { cookies, request, url } = event;
  const path = url.pathname;
  const authClient = getPylonAuthClient();

  // Check if admin exists; if not, force setup
  const isSetupComplete = await authClient.hasAdmin();

  if (!isSetupComplete && path !== '/setup') {
    if (isApiPath(path)) {
      return new Response(JSON.stringify({ error: 'Setup required' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw redirect(302, '/setup');
  }

  // If setup is complete, block /setup
  if (isSetupComplete && path === '/setup') {
    throw redirect(302, '/');
  }

  // Session validation via Pylon
  const session = await authClient.getSession(request);

  if (session?.userId) {
    const user = await authClient.getUserById(session.userId);
    if (user) {
      event.locals.admin = {
        id: user.id,
        email: user.email,
        name: user.name
      };
    }
  }

  // Origin validation for all mutating requests
  if (MUTATING_METHODS.has(request.method)) {
    if (!validateOrigin(request)) {
      if (isApiPath(path)) {
        return new Response(JSON.stringify({ error: 'Invalid origin' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('Invalid origin', { status: 403 });
    }

    // CSRF for API routes via X-CSRF-Token header
    if (isApiPath(path)) {
      const csrfHeader = request.headers.get('x-csrf-token');
      const csrfCookie = cookies.get('csrf');

      if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        return new Response(JSON.stringify({ error: 'Invalid CSRF token' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }
    // Form submissions CSRF is validated in individual form actions
  }

  // Generate CSRF token for GET requests if not present
  if (request.method === 'GET' && !cookies.get('csrf')) {
    const csrfToken = generateCsrfToken();
    event.locals.csrfToken = csrfToken;
    cookies.set('csrf', csrfToken, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: isSecureContext(request),
      maxAge: 60 * 60 * 24
    });
  } else if (cookies.get('csrf')) {
    event.locals.csrfToken = cookies.get('csrf');
  }

  // Auth gate for protected routes
  if (!session?.userId && !isPublicPath(path)) {
    if (isApiPath(path)) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw redirect(302, '/login');
  }

  return resolve(event);
};
