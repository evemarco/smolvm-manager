import { configToToml, validateVmConfig } from '$lib/server/vm-config';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.admin) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  let config;
  try {
    config = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validation = validateVmConfig(config);
  if (!validation.valid) {
    return json({ error: 'Validation failed', details: validation.errors }, { status: 400 });
  }

  const toml = configToToml(config);
  return json({ toml });
};
