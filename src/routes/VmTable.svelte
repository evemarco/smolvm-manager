<script lang="ts">
  import { Play, Square, RotateCw, Trash2, Loader2, Pencil, Copy } from '@lucide/svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import type { SmolVmMachine } from '$lib/types';

  let {
    machines,
    onSelect,
    onStart,
    onStop,
    onRestart,
    onDelete,
    onEdit,
    onCopy,
    actionLoading = {}
  }: {
    machines: SmolVmMachine[];
    onSelect: (m: SmolVmMachine) => void;
    onStart: (m: SmolVmMachine) => void;
    onStop: (m: SmolVmMachine) => void;
    onRestart: (m: SmolVmMachine) => void;
    onDelete: (m: SmolVmMachine) => void;
    onEdit?: (m: SmolVmMachine) => void;
    onCopy?: (m: SmolVmMachine) => void;
    actionLoading?: Record<string, boolean>;
  } = $props();
</script>

<div class="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60">
  <div class="overflow-x-auto">
    <table class="w-full text-left text-sm">
      <thead>
        <tr class="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500">
          <th class="px-4 py-3 font-medium">Name</th>
          <th class="px-4 py-3 font-medium">Status</th>
          <th class="px-4 py-3 font-medium text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each machines as machine (machine.name)}
          <tr class="border-b border-white/5 transition hover:bg-white/5">
            <td class="px-4 py-3">
              <button
                class="font-medium text-white hover:text-cyan-300 transition"
                onclick={() => onSelect(machine)}
              >
                {machine.name}
              </button>
            </td>
            <td class="px-4 py-3">
              <StatusBadge status={machine.status ?? machine.state ?? 'unknown'} />
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center justify-end gap-1">
                {#if (machine.status ?? machine.state ?? 'unknown') !== 'running'}
                  <button
                    class="rounded-md p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-emerald-400"
                    onclick={() => onStart(machine)}
                    disabled={actionLoading[`start-${machine.name}`]}
                    aria-label="Start {machine.name}"
                  >
                    {#if actionLoading[`start-${machine.name}`]}
                      <Loader2 size={14} class="animate-spin" />
                    {:else}
                      <Play size={14} />
                    {/if}
                  </button>
                {/if}
                {#if (machine.status ?? machine.state ?? 'unknown') === 'running'}
                  <button
                    class="rounded-md p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-amber-400"
                    onclick={() => onStop(machine)}
                    disabled={actionLoading[`stop-${machine.name}`]}
                    aria-label="Stop {machine.name}"
                  >
                    {#if actionLoading[`stop-${machine.name}`]}
                      <Loader2 size={14} class="animate-spin" />
                    {:else}
                      <Square size={14} />
                    {/if}
                  </button>
                {/if}
                <button
                  class="rounded-md p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-cyan-400"
                  onclick={() => onEdit?.(machine)}
                  aria-label="Edit {machine.name}"
                >
                  <Pencil size={14} />
                </button>
                <button
                  class="rounded-md p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-cyan-400"
                  onclick={() => onCopy?.(machine)}
                  aria-label="Copy {machine.name}"
                >
                  <Copy size={14} />
                </button>
                <button
                  class="rounded-md p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-amber-400"
                  onclick={() => onRestart(machine)}
                  disabled={actionLoading[`restart-${machine.name}`]}
                  aria-label="Restart {machine.name}"
                >
                  <RotateCw size={14} />
                </button>
                <button
                  class="rounded-md p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-red-400"
                  onclick={() => onDelete(machine)}
                  disabled={actionLoading[`delete-${machine.name}`]}
                  aria-label="Delete {machine.name}"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
