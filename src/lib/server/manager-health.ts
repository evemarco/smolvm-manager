import { APP_BUILD_TIME, APP_COMMIT } from '$lib/build-info';
import { getSmolVmClient, type SmolVmClient } from '$lib/server/smolvm-client';

export type ManagerHealth = {
  readonly commit: string;
  readonly buildTime: string;
  readonly smolvm: {
    readonly reachable: boolean;
    readonly version: string | null;
  };
};

export async function createManagerHealth(client?: SmolVmClient): Promise<ManagerHealth> {
  const smolvm = client ?? getSmolVmClient();
  try {
    const health = await smolvm.getHealth();
    return {
      commit: APP_COMMIT,
      buildTime: APP_BUILD_TIME,
      smolvm: { reachable: true, version: health.version ?? null }
    };
  } catch {
    return {
      commit: APP_COMMIT,
      buildTime: APP_BUILD_TIME,
      smolvm: { reachable: false, version: null }
    };
  }
}
