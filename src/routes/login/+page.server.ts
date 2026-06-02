import { fail, redirect } from '@sveltejs/kit';
import { getPylonAuthClient } from '$lib/server/pylon-auth-client';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (locals.admin) {
    throw redirect(302, '/');
  }
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    const data = await request.formData();
    const username = data.get('username')?.toString().trim();
    const password = data.get('password')?.toString();
    const csrf = data.get('csrf')?.toString();
    const csrfCookie = cookies.get('csrf');

    if (!csrf || !csrfCookie || csrf !== csrfCookie) {
      return fail(403, { error: 'Invalid CSRF token' });
    }

    if (!username || !password) {
      return fail(400, { error: 'Username and password are required' });
    }

    const authClient = getPylonAuthClient();
    const result = await authClient.signIn(username, password, request);

    if (!result.success) {
      await authClient.logAuditEvent(
        'login_failed',
        `Failed login for: ${username}`,
        getClientAddress()
      );
      return fail(401, { error: 'Invalid username or password' });
    }

    if (result.setCookie) {
      const cookieParts = result.setCookie.split(';');
      const sessionPart = cookieParts[0].trim();
      const [name, value] = sessionPart.split('=');
      if (name && value) {
        cookies.set(name, value, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
          secure: false,
          maxAge: 60 * 60 * 24
        });
      }
    }

    await authClient.logAuditEvent('login', `Admin '${username}' logged in`, getClientAddress());

    throw redirect(302, '/');
  }
};
