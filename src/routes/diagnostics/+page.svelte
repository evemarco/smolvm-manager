<script lang="ts">
  import { Activity, AlertCircle, RefreshCw, Loader2, ShieldAlert, Power } from '@lucide/svelte';
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let mounted = $state(false);
  let refreshing = $state(false);

  let drainOpen = $state(false);
  let drainLoading = $state(false);
  let drainError: string | null = $state(null);
  let drainSuccess: string | null = $state(null);

  onMount(() => {
    mounted = true;
  });

  async function refreshDiagnostics(): Promise<void> {
    refreshing = true;

    try {
      await invalidateAll();
    } finally {
      refreshing = false;
    }
  }

  async function submitDrain(): Promise<void> {
    drainLoading = true;
    drainError = null;
    drainSuccess = null;
    try {
      const response = await fetch('/api/smolvm/drain', {
        method: 'POST',
        headers: { 'x-csrf-token': data.csrfToken ?? '' }
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.error ?? body?.message ?? `Drain failed (${response.status})`);
      }
      drainSuccess = 'Node drained — all running machines stopped.';
      drainOpen = false;
      await invalidateAll();
    } catch (err) {
      drainError = err instanceof Error ? err.message : 'Drain failed';
    } finally {
      drainLoading = false;
    }
  }
</script>

<svelte:head>
  <title>Backend diagnostics - SmolVM Manager</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10 lg:px-10">
  <header class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div class="flex items-start gap-3">
      <div class="mt-1 flex size-10 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
        <Activity size={20} class="text-cyan-400" />
      </div>
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-white">Backend diagnostics</h1>
        <p class="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
          Recent SmolVM API failures captured by the manager. Entries are bounded to the current
          manager process and available only to authenticated administrators.
        </p>
      </div>
    </div>

    <div class="flex shrink-0 flex-col items-start gap-2 sm:items-end">
      <div class="flex gap-2">
        <button
          type="button"
          class="inline-flex items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-60"
          onclick={() => (drainOpen = true)}
          disabled={!mounted}
          aria-label="Drain the SmolVM node"
        >
          <Power size={14} />
          Drain node
        </button>
        <button
          type="button"
          class="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          onclick={refreshDiagnostics}
          disabled={!mounted || refreshing}
          aria-label="Refresh diagnostics"
          aria-busy={refreshing}
        >
          <RefreshCw size={14} class={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      <time datetime={data.refreshedAt} aria-live="polite" class="text-xs text-slate-400">
        Last refreshed {new Date(data.refreshedAt).toLocaleString()}
      </time>
    </div>
  </header>

  <section
    aria-label="Runtime versions"
    class="grid grid-cols-1 gap-3 rounded-2xl border border-white/10 bg-slate-900/60 p-4 sm:grid-cols-4 sm:p-5"
  >
    <div>
      <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Manager build</p>
      <p class="mt-1 font-mono text-sm text-white">{data.health.commit}</p>
    </div>
    <div>
      <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Built at</p>
      <p class="mt-1 text-sm text-slate-200">
        <time datetime={data.health.buildTime}>
          {new Date(data.health.buildTime).toLocaleString()}
        </time>
      </p>
    </div>
    <div>
      <p class="text-xs font-medium uppercase tracking-wide text-slate-500">SmolVM backend</p>
      <p class="mt-1 text-sm {data.health.smolvm.reachable ? 'text-emerald-300' : 'text-red-300'}">
        {data.health.smolvm.reachable ? (data.health.smolvm.version ?? 'reachable') : 'unreachable'}
      </p>
    </div>
    <div>
      <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Readiness</p>
      {#if data.readyz}
        <p class="mt-1 text-sm text-emerald-300">{data.readyz.status}</p>
      {:else}
        <p class="mt-1 text-sm text-red-300">unavailable</p>
      {/if}
    </div>
  </section>

  {#if drainSuccess}
    <section
      class="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-200"
      role="status"
    >
      <ShieldAlert size={16} />
      {drainSuccess}
    </section>
  {/if}

  {#if drainOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onclick={(e) => {
        if (e.target === e.currentTarget && !drainLoading) drainOpen = false;
      }}
      onkeydown={(e) => {
        if (e.key === 'Escape' && !drainLoading) drainOpen = false;
      }}
    >
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="w-full max-w-md rounded-2xl border border-red-500/20 bg-slate-900 p-6 shadow-2xl"
        onclick={(e) => e.stopPropagation()}
      >
        <div class="flex items-start gap-4">
          <div
            class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10"
          >
            <Power size={20} class="text-red-400" />
          </div>
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-semibold text-white">Drain node</h2>
            <p class="mt-2 text-sm leading-relaxed text-slate-300">
              This stops <span class="font-semibold text-red-300">ALL running machines</span> on the SmolVM
              node. Running workloads will be terminated. This action cannot be undone.
            </p>
          </div>
        </div>
        {#if drainError}
          <div
            class="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300"
            role="alert"
          >
            {drainError}
          </div>
        {/if}
        <div class="mt-6 flex justify-end gap-3">
          <button
            class="rounded-lg border border-white/10 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
            onclick={() => (drainOpen = false)}
            disabled={drainLoading}
          >
            Cancel
          </button>
          <button
            class="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
            onclick={submitDrain}
            disabled={drainLoading}
          >
            {#if drainLoading}
              <Loader2 size={14} class="animate-spin" />
            {/if}
            Drain node
          </button>
        </div>
      </div>
    </div>
  {/if}

  {#if data.diagnostics.length === 0}
    <section
      class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-slate-900/60 px-6 py-16 text-center"
    >
      <Activity size={28} class="text-slate-500" />
      <div>
        <h2 class="text-lg font-medium text-white">No backend errors recorded</h2>
        <p class="mt-1 text-sm text-slate-400">
          Failed SmolVM requests will appear here with their upstream details.
        </p>
      </div>
    </section>
  {:else}
    <section aria-label="SmolVM backend error log" class="flex flex-col gap-3">
      {#each data.diagnostics as entry (entry.id)}
        <article class="min-w-0 rounded-xl border border-red-500/20 bg-slate-900/70 p-4 sm:p-5">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div class="flex min-w-0 items-start gap-3">
              <AlertCircle size={18} class="mt-0.5 shrink-0 text-red-400" />
              <div class="min-w-0">
                <h2 class="wrap-break-word text-sm font-medium text-red-200">{entry.message}</h2>
                <p class="mt-1 font-mono text-xs text-slate-400">{entry.code}</p>
              </div>
            </div>
            <div class="flex shrink-0 items-center gap-2 text-xs text-slate-400">
              <span class="rounded-full bg-red-500/10 px-2 py-1 text-red-300">
                HTTP {entry.status}
              </span>
              <time datetime={entry.timestamp}>{new Date(entry.timestamp).toLocaleString()}</time>
            </div>
          </div>

          {#if entry.details !== undefined}
            <pre
              class="mt-4 max-h-80 overflow-auto whitespace-pre-wrap wrap-break-word rounded-lg border border-white/10 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-300">{JSON.stringify(
                entry.details,
                null,
                2
              )}</pre>
          {/if}
        </article>
      {/each}
    </section>
  {/if}
</div>
