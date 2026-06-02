import { redirect } from '@sveltejs/kit';
import { getPylonAuthClient } from '$lib/server/pylon-auth-client';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request, cookies, locals, getClientAddress }) => {
    const authClient = getPylonAuthClient();
    const result = await authClient.signOut(request);

    if (result.setCookie) {
      const cookieParts = result.setCookie.split(';');
      const sessionPart = cookieParts[0].trim();
      const [name] = sessionPart.split('=');
      if (name) {
        cookies.delete(name, { path: '/' });
      }
    }

    cookies.delete('csrf', { path: '/' });

    if (locals.admin) {
      await authClient.logAuditEvent(
        'logout',
        `Admin '${locals.admin.email}' logged out`,
        getClientAddress()
      );
    }

    throw redirect(302, '/login');
  }
};
