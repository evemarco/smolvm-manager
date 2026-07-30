import type { LayoutServerLoad } from './$types';

const DEFAULT_PYLON_PORT = 4321;

function resolvePylonPort(): number {
  const raw = process.env.PYLON_URL;
  if (raw && URL.canParse(raw)) {
    const port = Number(new URL(raw).port);
    if (Number.isInteger(port) && port > 0) return port;
  }
  return DEFAULT_PYLON_PORT;
}

export const load: LayoutServerLoad = async ({ locals }) => {
  return {
    admin: locals.admin ?? null,
    csrfToken: locals.csrfToken ?? null,
    pylonPort: resolvePylonPort()
  };
};
