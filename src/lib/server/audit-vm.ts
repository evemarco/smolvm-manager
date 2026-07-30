import { createServiceAuthContext, getManagerStoreClient } from '$lib/server/manager-store-client';

export type VmLifecycleAction =
  'vm.create' | 'vm.start' | 'vm.stop' | 'vm.delete' | 'vm.fork' | 'vm.export';

export type VmAuditStore = {
  insertAuditEvent: (
    entry: {
      eventType: string;
      actorUserId?: string;
      action?: string;
      details?: string;
      ipAddress?: string;
    },
    authContext: unknown
  ) => Promise<unknown>;
};

type AuditVmActionOptions = {
  readonly action: VmLifecycleAction;
  readonly machineName: string;
  readonly actorUserId: string;
  readonly request: Request;
  readonly getClientAddress?: () => string;
  readonly store?: VmAuditStore;
};

function getClientIp(
  request: Request,
  getClientAddress: (() => string) | undefined
): string | undefined {
  const forwardedFor = request.headers.get('x-forwarded-for');
  return forwardedFor?.split(',')[0]?.trim() || getClientAddress?.() || undefined;
}

// Restart is client-side stop+start, so it is represented by those two lifecycle events.
// Persistence is best-effort: the SmolVM action already succeeded, so an audit store
// failure must not turn the lifecycle response into a 5xx (retries would duplicate it).
export async function auditVmAction(options: AuditVmActionOptions): Promise<void> {
  const serviceAuth = createServiceAuthContext();
  const store = options.store ?? getManagerStoreClient();
  try {
    await store.insertAuditEvent(
      {
        eventType: 'vm.lifecycle',
        actorUserId: options.actorUserId,
        action: options.action,
        details: JSON.stringify({ machineName: options.machineName }),
        ipAddress: getClientIp(options.request, options.getClientAddress)
      },
      serviceAuth
    );
  } catch (error) {
    console.error('[audit-vm] failed to persist lifecycle event', {
      action: options.action,
      machineName: options.machineName,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
