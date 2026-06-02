<script lang="ts">
  import { ArrowLeft, Play, Square, RotateCw, Trash2, Loader2, Server } from '@lucide/svelte';
  import StatusBadge from '$lib/components/StatusBadge.svelte';
  import type { SmolVmMachine, TabId } from '$lib/types';

  let {
    machine,
    onBack,
    onStart,
    onStop,
    onRestart,
    onDelete,
    actionLoading = {}
  }: {
    machine: SmolVmMachine;
    onBack: () => void;
    onStart: (m: SmolVmMachine) => void;
    onStop: (m: SmolVmMachine) => void;
    onRestart: (m: SmolVmMachine) => void;
    onDelete: (m: SmolVmMachine) => void;
    actionLoading?: Record<string, boolean>;
  } = $props();

  const machineStatus = $derived(machine.status ?? machine.state ?? 'unknown');
  const isRunning = $derived(machineStatus === 'running');

  let activeTab: TabId = $state('overview');

  const tabs: { id: TabId; label: string; disabled?: boolean }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'config', label: 'Config', disabled: true },
    { id: 'logs', label: 'Logs', disabled: true },
    { id: 'terminal', label: 'Terminal', disabled: true },
    { id: 'metrics', label: 'Metrics', disabled: true }
  ];

  const placeholderMessages: Record<string, string> = {
    config: 'VM configuration editing will be available in a future update.',
    logs: 'Real-time log streaming will be available in a future update.',
    terminal: 'Browser terminal access will be available in a future update.',
    metrics: 'Live metrics and history charts will be available in a future update.'
  };
</script>

<div class="flex flex-col gap-6">
  <!-- Back + header -->
  <div class="flex items-center gap-4">
    <button
      class="rounded-lg border border-white/10 bg-slate-800/80 p-2 text-slate-400 transition hover:bg-slate-700 hover:text-white"
      onclick={onBack}
      aria-label="Back to machine list"
    >
      <ArrowLeft size={18} />
    </button>
    <div class="flex-1">
      <div class="flex items-center gap-3">
        <h2 class="text-2xl font-semibold text-white">{machine.name}</h2>
        <StatusBadge status={machineStatus} />
      </div>
    </div>
    <div class="flex items-center gap-2">
      {#if !isRunning}
        <button
          class="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:opacity-50"
          onclick={() => onStart(machine)}
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
          class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white disabled:opacity-50"
          onclick={() => onStop(machine)}
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
        class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm font-medium text-amber-300 transition hover:bg-slate-700 hover:text-amber-200 disabled:opacity-50"
        onclick={() => onRestart(machine)}
        disabled={actionLoading[`restart-${machine.name}`]}
      >
        <RotateCw size={14} />
        Restart
      </button>
      <button
        class="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
        onclick={() => onDelete(machine)}
        disabled={actionLoading[`delete-${machine.name}`]}
      >
        <Trash2 size={14} />
        Delete
      </button>
    </div>
  </div>

  <!-- Tabs -->
  <div class="flex gap-1 rounded-xl border border-white/10 bg-slate-900/60 p-1">
    {#each tabs as tab (tab.id)}
      <button
        class="rounded-lg px-4 py-2 text-sm font-medium transition {activeTab === tab.id
          ? 'bg-cyan-500/20 text-cyan-300'
          : tab.disabled
            ? 'cursor-not-allowed text-slate-600'
            : 'text-slate-400 hover:text-white'}"
        onclick={() => !tab.disabled && (activeTab = tab.id)}
        disabled={tab.disabled}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- Tab content -->
  <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
    {#if activeTab === 'overview'}
      <div class="flex flex-col gap-6">
        <div class="flex items-center gap-4">
          <div class="flex size-12 items-center justify-center rounded-xl bg-slate-800">
            <Server size={24} class="text-cyan-400" />
          </div>
          <div>
            <h3 class="text-lg font-medium text-white">{machine.name}</h3>
            <p class="text-sm text-slate-400">
              Status: <span class="capitalize">{machineStatus}</span>
            </p>
          </div>
        </div>

        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {#each Object.entries(machine) as [key, value] (key)}
            {#if key !== 'name' && key !== 'status' && key !== 'state' && value != null}
              <div class="rounded-xl border border-white/5 bg-slate-950/50 px-4 py-3">
                <p class="text-xs uppercase tracking-wider text-slate-500">{key}</p>
                <p class="mt-1 text-sm text-white">
                  {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </p>
              </div>
            {/if}
          {/each}
        </div>
      </div>
    {:else}
      <div class="flex flex-col items-center justify-center gap-3 py-12">
        <p class="text-sm text-slate-400">{placeholderMessages[activeTab] ?? 'Coming soon.'}</p>
      </div>
    {/if}
  </div>
</div>
