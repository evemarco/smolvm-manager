import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async () => {
  return json(
    {
      available: false,
      feature: 'update',
      message:
        'SmolVM does not support live machine updates yet. Use the recreate endpoint for configuration changes.'
    },
    { status: 501 }
  );
};
