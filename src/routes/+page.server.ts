import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  return {
    csrfToken: locals.csrfToken ?? null
  };
};
