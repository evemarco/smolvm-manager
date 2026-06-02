import { parseTomlToConfig, validateVmConfig } from '$lib/server/vm-config';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.admin) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  let toml: string;
  try {
    const body = await request.json();
    toml = body.toml;
    if (typeof toml !== 'string') {
      return json({ error: 'Missing or invalid "toml" field' }, { status: 400 });
    }
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { config, errors: parseErrors } = parseTomlToConfig(toml);
  const validation = validateVmConfig(config);

  return json({
    config,
    parseErrors: parseErrors.length > 0 ? parseErrors : undefined,
    validation: {
      valid: validation.valid,
      errors: validation.errors.length > 0 ? validation.errors : undefined
    }
  });
};
