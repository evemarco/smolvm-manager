/**
 * Shared source of truth for SmolVM machine update capabilities.
 *
 * The SmolVM CLI `machine update` only supports a fixed set of fields
 * (verified against 1.6.13/1.7.x `--help`). Every other config change
 * requires deleting and recreating the VM. Both the server update planner
 * (`$lib/server/smolvm-machine-update.ts`) and the client config form
 * (`VmConfigForm.svelte`) must agree on this classification, otherwise the
 * form submits a PATCH that the server can only reject with a 409.
 */

/** Fields changeable through `smolvm machine update` (live update on a stopped VM). */
export const LIVE_UPDATABLE_FIELDS: ReadonlySet<string> = new Set([
  'cpus',
  'memory',
  'storage',
  'overlay',
  'net',
  'gpu',
  'ports',
  'volumes',
  'env',
  'workdir'
]);

/**
 * Fields that define the VM's image and can never change without recreation.
 * Subset of the non-live-updatable fields, kept explicit because these are
 * the "hard" recreate triggers (a new image fundamentally means a new VM).
 */
export const RECREATE_REQUIRED_FIELDS: ReadonlySet<string> = new Set([
  'image',
  'tag',
  'from',
  'entrypoint',
  'cmd'
]);

/**
 * Returns true when changing `field` cannot be applied by
 * `smolvm machine update` and therefore requires VM recreation.
 * `name` is excluded: it identifies the machine rather than configuring it.
 */
export function fieldChangeRequiresRecreate(field: string): boolean {
  if (field === 'name') return false;
  return !LIVE_UPDATABLE_FIELDS.has(field);
}
