<script lang="ts">
  import { Play, Square, RotateCw, Trash2, Loader2, MoreVertical, Monitor } from '@lucide/svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import type { SmolVmMachine } from '$lib/types';

  let {
    machine,
    onSelect,
    onStart,
    onStop,
    onRestart,
    onDelete,
    actionLoading = {}
  }: {
    machine: SmolVmMachine;
    onSelect: (m: SmolVmMachine) => void;
    onStart: (m: SmolVmMachine) => void;
    onStop: (m: SmolVmMachine) => void;
    onRestart: (m: SmolVmMachine) => void;
    onDelete: (m: SmolVmMachine) => void;
    actionLoading?: Record<string, boolean>;
  } = $props();

  const machineStatus = $derived(machine.status ?? machine.state ?? 'unknown');
  const isRunning = $derived(machineStatus === 'running');

  let menuOpen = $state(false);

  function closeMenu() {
    menuOpen = false;
  }
</script>

<div
  class="group relative rounded-2xl border border-white/10 bg-slate-900/60 p-5 transition hover:border-white/20"
>
  <!-- Card header -->
  <div class="flex items-start justify-between">
    <button
      class="flex-1 text-left"
      onclick={() => onSelect(machine)}
      aria-label="View details for {machine.name}"
    >
      <h3 class="text-base font-medium text-white group-hover:text-cyan-300 transition">
        {machine.name}
      </h3>
    </button>
    <div class="flex items-center gap-2">
      <StatusBadge status={machineStatus} />
      <div class="relative">
        <button
          class="rounded-md p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
          onclick={() => (menuOpen = !menuOpen)}
          aria-label="Actions for {machine.name}"
          aria-haspopup="true"
          aria-expanded={menuOpen}
        >
          <MoreVertical size={16} />
        </button>
        {#if menuOpen}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="absolute right-0 top-full z-20 mt-1 w-44 rounded-xl border border-white/10 bg-slate-800 py-1 shadow-xl"
            onclick={closeMenu}
            onkeydown={(e) => e.key === 'Escape' && closeMenu()}
          >
            {#if !isRunning}
              <button
                class="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
                onclick={() => {
                  onStart(machine);
                  closeMenu();
                }}
                disabled={actionLoading[`start-${machine.name}`]}
              >
                {#if actionLoading[`start-${machine.name}`]}
                  <Loader2 size={14} class="animate-spin" />
                {:else}
                  <Play size={14} />
                {/if}
                Start
              </button>
            {/if}
            {#if isRunning}
              <button
                class="flex w-full items-center gap-2 px-3 py-2 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
                onclick={() => {
                  onStop(machine);
                  closeMenu();
                }}
                disabled={actionLoading[`stop-${machine.name}`]}
              >
                {#if actionLoading[`stop-${machine.name}`]}
                  <Loader2 size={14} class="animate-spin" />
                {:else}
                  <Square size={14} />
                {/if}
                Stop
              </button>
            {/if}
            <button
              class="flex w-full items-center gap-2 px-3 py-2 text-sm text-amber-300 transition hover:bg-white/5 hover:text-amber-200"
              onclick={() => {
                onRestart(machine);
                closeMenu();
              }}
              disabled={actionLoading[`restart-${machine.name}`]}
            >
              <RotateCw size={14} />
              Restart
            </button>
            <div class="my-1 border-t border-white/5"></div>
            <button
              class="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-400 transition hover:bg-white/5 hover:text-red-300"
              onclick={() => {
                onDelete(machine);
                closeMenu();
              }}
              disabled={actionLoading[`delete-${machine.name}`]}
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Card body -->
  <div class="mt-4 flex items-center gap-4 text-xs text-slate-500">
    <span class="flex items-center gap-1">
      <Monitor size={12} />
      VM
    </span>
  </div>
</div>
