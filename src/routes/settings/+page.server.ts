import { fail } from '@sveltejs/kit';
import { getManagerStoreClient } from '$lib/server/manager-store-client';
import { DOCKER_HUB_TOKEN_SETTING_KEY } from '$lib/server/docker-hub';
import type { Actions, PageServerLoad } from './$types';

function readStoredCredentials(valueJson: string | undefined): { username: string; token: string } {
  if (!valueJson) return { username: '', token: '' };
  try {
    const parsed = JSON.parse(valueJson) as { username?: unknown; token?: unknown };
    return {
      username: typeof parsed.username === 'string' ? parsed.username.trim() : '',
      token: typeof parsed.token === 'string' ? parsed.token.trim() : ''
    };
  } catch {
    return { username: '', token: '' };
  }
}

export const load: PageServerLoad = async () => {
  let stored = { username: '', token: '' };
  try {
    const setting = await getManagerStoreClient().getSetting(DOCKER_HUB_TOKEN_SETTING_KEY);
    stored = readStoredCredentials(setting?.valueJson);
  } catch {
    stored = { username: '', token: '' };
  }

  return {
    storedTokenSet: stored.token.length > 0,
    storedUsername: stored.username || null,
    storedTokenPreview: stored.token ? `…${stored.token.slice(-4)}` : null,
    envTokenSet: Boolean(process.env.DOCKER_HUB_TOKEN?.trim())
  };
};

export const actions: Actions = {
  save: async ({ request, cookies }) => {
    const data = await request.formData();
    const csrf = data.get('csrf')?.toString();
    if (!csrf || csrf !== cookies.get('csrf')) {
      return fail(403, { error: 'Invalid CSRF token' });
    }

    const username = data.get('username')?.toString().trim() ?? '';
    const token = data.get('token')?.toString().trim() ?? '';
    if (!username) {
      return fail(400, { error: 'Docker Hub username is required.' });
    }
    if (token.length < 10) {
      return fail(400, { error: 'Token looks too short — paste the full Docker Hub access token.' });
    }

    await getManagerStoreClient().setSetting(
      DOCKER_HUB_TOKEN_SETTING_KEY,
      JSON.stringify({ username, token })
    );
    return { saved: true };
  },

  clear: async ({ request, cookies }) => {
    const data = await request.formData();
    const csrf = data.get('csrf')?.toString();
    if (!csrf || csrf !== cookies.get('csrf')) {
      return fail(403, { error: 'Invalid CSRF token' });
    }

    await getManagerStoreClient().setSetting(
      DOCKER_HUB_TOKEN_SETTING_KEY,
      JSON.stringify({ username: '', token: '' })
    );
    return { cleared: true };
  }
};
