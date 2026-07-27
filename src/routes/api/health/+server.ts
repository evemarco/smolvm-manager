import { createManagerHealth } from '$lib/server/manager-health';
import type { RequestHandler } from './$types';

// Public, unauthenticated health probe: lets monitoring and the production
// upgrade script verify which build is actually serving. Discloses only the
// commit hash, build time, and SmolVM reachability/version.
export const GET: RequestHandler = async () =>
  new Response(JSON.stringify(await createManagerHealth()), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
