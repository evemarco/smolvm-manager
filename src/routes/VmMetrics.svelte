<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Cpu,
    HardDrive,
    MemoryStick,
    AlertTriangle,
    Loader2,
    RefreshCw,
    Activity
  } from '@lucide/svelte';
  import { createMetricsHistorySync, type MetricsHistorySync } from '$lib/client/pylon-sync';
  import type { MetricsSnapshot, MetricsSample } from '$lib/types';

  let { machineName }: { machineName: string } = $props();

  let snapshot: MetricsSnapshot | null = $state(null);
  let history: MetricsSample[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let historyLoading = $state(false);
  let metricsHistorySync: MetricsHistorySync | null = null;

  function formatNumber(value: number, decimals = 1): string {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(decimals)}M`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(decimals)}K`;
    return value.toFixed(decimals);
  }

  function formatMemory(mb: number): string {
    if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
    return `${Math.round(mb)} MB`;
  }

  function formatDisk(gb: number): string {
    if (gb >= 1024) return `${(gb / 1024).toFixed(1)} TB`;
    return `${gb.toFixed(1)} GB`;
  }

  function cpuPercent(): number {
    if (!snapshot) return 0;
    return Math.min(
      (snapshot.capacity.usedCpus / Math.max(snapshot.capacity.allocatedCpus, 1)) * 100,
      100
    );
  }

  function memoryPercent(): number {
    if (!snapshot) return 0;
    return Math.min(
      (snapshot.capacity.usedMemoryMb / Math.max(snapshot.capacity.allocatedMemoryMb, 1)) * 100,
      100
    );
  }

  function diskPercent(): number {
    if (!snapshot) return 0;
    return Math.min(snapshot.capacity.usedDiskGb * 2, 100);
  }

  function barHeight(value: number, max: number): string {
    const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    return `${pct}%`;
  }

  function barColor(type: 'cpu' | 'memory'): string {
    return type === 'cpu'
      ? 'bg-cyan-400/70 hover:bg-cyan-400'
      : 'bg-violet-400/70 hover:bg-violet-400';
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  async function fetchSnapshot() {
    loading = true;
    error = null;
    try {
      const response = await fetch('/api/smolvm/metrics');
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? `Failed to load metrics (${response.status})`);
      }
      snapshot = await response.json();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load metrics';
    } finally {
      loading = false;
    }
  }

  async function fetchHistory() {
    historyLoading = true;
    const historyUrl = machineName
      ? `/api/smolvm/metrics/history?machine=${encodeURIComponent(machineName)}&limit=100`
      : '/api/smolvm/metrics/history?limit=100';

    try {
      const response = await fetch(historyUrl);
      if (!response.ok) {
        return;
      }
      const body = await response.json();
      history = body.samples ?? [];
    } catch {
      // History is supplementary; don't surface errors
    } finally {
      historyLoading = false;
    }
  }

  async function refresh() {
    await Promise.all([fetchSnapshot(), fetchHistory(), metricsHistorySync?.refresh()]);
  }

  onMount(() => {
    metricsHistorySync = createMetricsHistorySync({
      machineName,
      limit: 100,
      onSamples: (samples) => (history = samples)
    });
    refresh();

    void metricsHistorySync.start();

    return () => {
      metricsHistorySync?.stop();
      metricsHistorySync = null;
    };
  });
</script>

<div class="flex flex-col gap-6">
  <!-- Header -->
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h3 class="text-lg font-medium text-white">Live metrics</h3>
      <p class="text-sm text-slate-400">
        Resource usage from SmolVM capacity and metrics endpoints.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <button
        class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
        onclick={refresh}
        disabled={loading}
      >
        <RefreshCw size={14} class={loading ? 'animate-spin' : ''} />
        Refresh
      </button>
    </div>
  </div>

  {#if loading && !snapshot}
    <div class="flex flex-col items-center justify-center gap-3 py-12">
      <Loader2 size={32} class="animate-spin text-cyan-400" />
      <p class="text-sm text-slate-400">Loading metrics...</p>
    </div>
  {:else if error}
    <div
      class="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-300"
    >
      <AlertTriangle size={16} />
      {error}
    </div>
  {:else if snapshot}
    <!-- Per-VM unavailable notice -->
    {#if snapshot.summary.perVmUnavailable}
      <div
        class="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
      >
        <AlertTriangle size={16} />
        Per-VM metrics are unavailable. Showing global capacity data only.
      </div>
    {/if}

    <!-- Capacity cards -->
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <!-- CPU -->
      <div class="rounded-xl border border-white/10 bg-slate-900/80 p-4">
        <div class="flex items-center gap-3">
          <div class="flex size-10 items-center justify-center rounded-lg bg-cyan-500/10">
            <Cpu size={20} class="text-cyan-400" />
          </div>
          <div class="flex-1">
            <p class="text-xs uppercase tracking-wider text-slate-500">CPU</p>
            <p class="text-xl font-semibold text-white">
              {formatNumber(snapshot.capacity.usedCpus)}
              <span class="text-sm font-normal text-slate-400">
                / {snapshot.capacity.allocatedCpus} allocated
              </span>
            </p>
          </div>
        </div>
        <div class="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            class="h-full rounded-full bg-cyan-500 transition-all duration-500"
            style="width: {cpuPercent()}%"
          ></div>
        </div>
      </div>

      <!-- Memory -->
      <div class="rounded-xl border border-white/10 bg-slate-900/80 p-4">
        <div class="flex items-center gap-3">
          <div class="flex size-10 items-center justify-center rounded-lg bg-violet-500/10">
            <MemoryStick size={20} class="text-violet-400" />
          </div>
          <div class="flex-1">
            <p class="text-xs uppercase tracking-wider text-slate-500">Memory</p>
            <p class="text-xl font-semibold text-white">
              {formatMemory(snapshot.capacity.usedMemoryMb)}
              <span class="text-sm font-normal text-slate-400">
                / {formatMemory(snapshot.capacity.allocatedMemoryMb)} allocated
              </span>
            </p>
          </div>
        </div>
        <div class="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            class="h-full rounded-full bg-violet-500 transition-all duration-500"
            style="width: {memoryPercent()}%"
          ></div>
        </div>
      </div>

      <!-- Disk -->
      <div class="rounded-xl border border-white/10 bg-slate-900/80 p-4">
        <div class="flex items-center gap-3">
          <div class="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10">
            <HardDrive size={20} class="text-emerald-400" />
          </div>
          <div class="flex-1">
            <p class="text-xs uppercase tracking-wider text-slate-500">Disk</p>
            <p class="text-xl font-semibold text-white">
              {formatDisk(snapshot.capacity.usedDiskGb)}
            </p>
          </div>
        </div>
        <div class="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
          <div
            class="h-full rounded-full bg-emerald-500 transition-all duration-500"
            style="width: {diskPercent()}%"
          ></div>
        </div>
      </div>
    </div>

    <!-- VM counts -->
    <div class="grid gap-4 sm:grid-cols-2">
      {#if snapshot.summary.machinesRunning !== null}
        <div class="rounded-xl border border-white/10 bg-slate-900/80 p-4">
          <div class="flex items-center gap-3">
            <div class="flex size-10 items-center justify-center rounded-lg bg-emerald-500/10">
              <Activity size={20} class="text-emerald-400" />
            </div>
            <div>
              <p class="text-xs uppercase tracking-wider text-slate-500">Running VMs</p>
              <p class="text-xl font-semibold text-white">{snapshot.summary.machinesRunning}</p>
            </div>
          </div>
        </div>
      {/if}
      {#if snapshot.summary.machinesTotal !== null}
        <div class="rounded-xl border border-white/10 bg-slate-900/80 p-4">
          <div class="flex items-center gap-3">
            <div class="flex size-10 items-center justify-center rounded-lg bg-slate-500/10">
              <Activity size={20} class="text-slate-400" />
            </div>
            <div>
              <p class="text-xs uppercase tracking-wider text-slate-500">Total VMs</p>
              <p class="text-xl font-semibold text-white">{snapshot.summary.machinesTotal}</p>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- History bar charts -->
    {#if history.length > 1}
      {@const maxCpu = Math.max(...history.map((s) => s.cpu), 0.1)}
      {@const maxMem = Math.max(...history.map((s) => s.memoryMb), 1)}

      <!-- CPU history -->
      <div class="rounded-xl border border-white/10 bg-slate-900/80 p-4">
        <h4 class="mb-3 text-sm font-medium text-slate-300">CPU Usage History</h4>
        <div class="flex h-32 items-end gap-px">
          {#each history as sample, i (sample.id ?? i)}
            <div
              class="flex-1 rounded-t-sm transition-all duration-200 {barColor('cpu')}"
              style="height: {barHeight(sample.cpu, maxCpu)}"
              title="{formatNumber(sample.cpu)} CPUs — {formatTime(sample.sampledAt)}"
            ></div>
          {/each}
        </div>
        <div class="mt-2 flex justify-between text-xs text-slate-500">
          <span>{formatTime(history[0].sampledAt)}</span>
          <span>{formatTime(history[history.length - 1].sampledAt)}</span>
        </div>
      </div>

      <!-- Memory history -->
      <div class="rounded-xl border border-white/10 bg-slate-900/80 p-4">
        <h4 class="mb-3 text-sm font-medium text-slate-300">Memory Usage History</h4>
        <div class="flex h-32 items-end gap-px">
          {#each history as sample, i (sample.id ?? i)}
            <div
              class="flex-1 rounded-t-sm transition-all duration-200 {barColor('memory')}"
              style="height: {barHeight(sample.memoryMb, maxMem)}"
              title="{formatMemory(sample.memoryMb)} — {formatTime(sample.sampledAt)}"
            ></div>
          {/each}
        </div>
        <div class="mt-2 flex justify-between text-xs text-slate-500">
          <span>{formatTime(history[0].sampledAt)}</span>
          <span>{formatTime(history[history.length - 1].sampledAt)}</span>
        </div>
      </div>
    {:else if historyLoading}
      <div class="flex items-center justify-center gap-2 py-8 text-sm text-slate-400">
        <Loader2 size={16} class="animate-spin" />
        Loading history...
      </div>
    {/if}
  {:else}
    <div class="flex flex-col items-center justify-center gap-3 py-12">
      <p class="text-sm text-slate-400">No metrics data available.</p>
    </div>
  {/if}
</div>
