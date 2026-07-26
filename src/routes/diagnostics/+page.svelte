<script lang="ts">
  import { Activity, AlertCircle, RefreshCw } from '@lucide/svelte';
  import { invalidateAll } from '$app/navigation';
  import { onMount } from 'svelte';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
  let mounted = $state(false);
  let refreshing = $state(false);

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
      <time datetime={data.refreshedAt} aria-live="polite" class="text-xs text-slate-400">
        Last refreshed {new Date(data.refreshedAt).toLocaleString()}
      </time>
    </div>
  </header>

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
