<script lang="ts">
  import { HardDrive, Plus, Trash2, Loader2, AlertTriangle, CheckCircle2 } from '@lucide/svelte';
  import type { SmolVmVolumeInfo } from '$lib/types';

  let { csrfToken }: { csrfToken: string } = $props();

  let provisionId = $state('');
  let provisionSize = $state<number | undefined>(undefined);
  let provisioning = $state(false);
  let provisionError: string | null = $state(null);
  let provisioned: SmolVmVolumeInfo[] = $state([]);

  let deleteId = $state('');
  let deleting = $state(false);
  let deleteError: string | null = $state(null);
  let deleteMessage: string | null = $state(null);

  async function provision() {
    if (!provisionSize || provisionSize <= 0) {
      provisionError = 'Size must be a positive number of GiB.';
      return;
    }
    provisioning = true;
    provisionError = null;
    try {
      const body: Record<string, unknown> = { sizeGb: provisionSize };
      if (provisionId.trim()) body.id = provisionId.trim();
      const response = await fetch('/api/smolvm/volumes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? data?.message ?? `Provision failed (${response.status})`);
      }
      provisioned = [
        {
          id: String(data?.id ?? provisionId.trim() ?? 'unknown'),
          nodePath: String(data?.nodePath ?? ''),
          sizeGb: provisionSize
        },
        ...provisioned
      ];
      provisionId = '';
      provisionSize = undefined;
    } catch (err) {
      provisionError = err instanceof Error ? err.message : 'Provision failed';
    } finally {
      provisioning = false;
    }
  }

  async function deleteVolume() {
    const id = deleteId.trim();
    if (!id) {
      deleteError = 'Volume id is required.';
      return;
    }
    deleting = true;
    deleteError = null;
    deleteMessage = null;
    try {
      const response = await fetch(`/api/smolvm/volumes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken }
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? data?.message ?? `Delete failed (${response.status})`);
      }
      deleteMessage = `Volume "${id}" deleted.`;
      provisioned = provisioned.filter((v) => v.id !== id);
      deleteId = '';
    } catch (err) {
      deleteError = err instanceof Error ? err.message : 'Delete failed';
    } finally {
      deleting = false;
    }
  }
</script>

<div class="rounded-xl border border-white/10 bg-slate-900/60">
  <div class="flex items-center gap-2 px-4 py-3">
    <HardDrive size={16} class="text-emerald-400" />
    <h3 class="text-sm font-medium text-white">Volumes</h3>
    <span class="text-xs text-slate-500">SmolVM-managed storage volumes</span>
  </div>

  <div class="flex flex-col gap-4 border-t border-white/5 px-4 py-4">
    <div>
      <p class="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">Provision</p>
      <div class="flex flex-wrap gap-2">
        <label for="volume-id" class="sr-only">Volume id (optional)</label>
        <input
          id="volume-id"
          type="text"
          bind:value={provisionId}
          placeholder="id (optional)"
          class="flex-1 min-w-[140px] rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
        />
        <label for="volume-size" class="sr-only">Size in GiB</label>
        <input
          id="volume-size"
          type="number"
          bind:value={provisionSize}
          placeholder="sizeGiB"
          min="1"
          class="w-28 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
        />
        <button
          class="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
          onclick={provision}
          disabled={provisioning}
        >
          {#if provisioning}
            <Loader2 size={14} class="animate-spin" />
          {:else}
            <Plus size={14} />
          {/if}
          Provision
        </button>
      </div>
      {#if provisionError}
        <div
          class="mt-2 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300"
        >
          <AlertTriangle size={14} class="mt-0.5 shrink-0" />
          {provisionError}
        </div>
      {/if}
    </div>

    {#if provisioned.length > 0}
      <div>
        <p class="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">
          Provisioned this session
        </p>
        <ul class="flex flex-col gap-1.5">
          {#each provisioned as vol (vol.id + '-' + vol.nodePath)}
            <li
              class="flex items-center gap-2 rounded-lg border border-white/5 bg-slate-950/60 px-3 py-2 text-xs"
            >
              <CheckCircle2 size={14} class="shrink-0 text-emerald-400" />
              <span class="font-mono text-cyan-300">{vol.id}</span>
              <span class="text-slate-500">→</span>
              <span class="truncate font-mono text-slate-300">{vol.nodePath}</span>
              {#if vol.sizeGb}
                <span class="ml-auto shrink-0 text-slate-500">{vol.sizeGb} GiB</span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}

    <div>
      <p class="mb-2 text-xs font-medium uppercase tracking-wider text-slate-400">Delete</p>
      <div class="flex gap-2">
        <label for="volume-delete-id" class="sr-only">Volume id to delete</label>
        <input
          id="volume-delete-id"
          type="text"
          bind:value={deleteId}
          placeholder="volume id"
          class="flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
        />
        <button
          class="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-sm font-medium text-red-300 transition hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
          onclick={deleteVolume}
          disabled={deleting}
        >
          {#if deleting}
            <Loader2 size={14} class="animate-spin" />
          {:else}
            <Trash2 size={14} />
          {/if}
          Delete
        </button>
      </div>
      {#if deleteError}
        <div
          class="mt-2 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300"
        >
          <AlertTriangle size={14} class="mt-0.5 shrink-0" />
          {deleteError}
        </div>
      {/if}
      {#if deleteMessage}
        <p class="mt-2 text-xs text-emerald-300">{deleteMessage}</p>
      {/if}
    </div>
  </div>
</div>
