import { fail, redirect } from '@sveltejs/kit';
import { getPylonAuthClient } from '$lib/server/pylon-auth-client';
import type { PageServerLoad, Actions } from './$types';

export const load: PageServerLoad = async () => {
  const authClient = getPylonAuthClient();
  const hasAdmin = await authClient.hasAdmin();
  if (hasAdmin) {
    throw redirect(302, '/');
  }
  return {};
};

export const actions: Actions = {
  default: async ({ request, cookies, getClientAddress }) => {
    const authClient = getPylonAuthClient();
    const hasAdmin = await authClient.hasAdmin();
    if (hasAdmin) {
      throw redirect(302, '/');
    }

    const data = await request.formData();
    const username = data.get('username')?.toString().trim();
    const password = data.get('password')?.toString();
    const confirmPassword = data.get('confirm_password')?.toString();
    const csrf = data.get('csrf')?.toString();
    const csrfCookie = cookies.get('csrf');

    if (!csrf || !csrfCookie || csrf !== csrfCookie) {
      return fail(403, { error: 'Invalid CSRF token' });
    }

    if (!username || !password || !confirmPassword) {
      return fail(400, { error: 'All fields are required' });
    }

    if (username.length < 3 || username.length > 32) {
      return fail(400, { error: 'Username must be between 3 and 32 characters' });
    }

    if (password.length < 8) {
      return fail(400, { error: 'Password must be at least 8 characters' });
    }

    if (password !== confirmPassword) {
      return fail(400, { error: 'Passwords do not match' });
    }

    const result = await authClient.signUp(username, password, request);

    if (!result.success) {
      return fail(400, { error: result.error });
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

    await authClient.logAuditEvent('setup', `Admin '${username}' created`, getClientAddress());

    throw redirect(302, '/');
  }
};
