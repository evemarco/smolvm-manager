import { error } from '@sveltejs/kit';
import { getPylonAuthClient } from '$lib/server/pylon-auth-client';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request, locals }) => {
  const authClient = getPylonAuthClient();
  const session = await authClient.getSession(request);

  if (!session?.userId) {
    throw error(401, 'Unauthorized');
  }

  return new Response(
    JSON.stringify({
      message: 'Hello from protected API',
      admin: locals.admin?.email ?? session.userId
    }),
    {
      headers: { 'Content-Type': 'application/json' }
    }
  );
};
