<script lang="ts">
  import { onMount } from 'svelte';
  import { ScrollText } from '@lucide/svelte';

  type AuditEvent = {
    id: string;
    eventType: string;
    actorUserId: string | null;
    action: string | null;
    details: string | null;
    ipAddress: string | null;
    createdAt: string;
  };

  let events = $state<AuditEvent[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let limit = $state(50);
  let loadingMore = $state(false);

  async function fetchEvents() {
    try {
      const response = await fetch(`/api/audit/events?limit=${limit}`);
      if (!response.ok) {
        throw new Error('Failed to load audit events');
      }
      const data = await response.json();
      events = data.events;
      error = null;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load audit events';
    } finally {
      loading = false;
      loadingMore = false;
    }
  }

  async function loadMore() {
    loadingMore = true;
    limit += 100;
    await fetchEvents();
  }

  function formatDetails(details: string | null): string {
    if (!details) return '—';
    try {
      const parsed = JSON.parse(details);
      return Object.entries(parsed)
        .map(([key, value]) => `${key}: ${String(value)}`)
        .join(', ');
    } catch {
      return details;
    }
  }

  function formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  onMount(() => {
    void fetchEvents();
  });
</script>

<svelte:head>
  <title>Audit Events - SmolVM Manager</title>
</svelte:head>

<div class="mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-10">
  <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-8 shadow-xl">
    <div class="flex items-start gap-3">
      <div class="mt-1 flex size-10 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
        <ScrollText size={20} class="text-cyan-400" />
      </div>
      <div class="flex-1">
        <h1 class="text-xl font-semibold text-white">Audit Events</h1>
        <p class="mt-1 text-sm text-slate-400">Security and lifecycle events from the manager.</p>
      </div>
    </div>

    <div class="mt-4 rounded-lg border border-white/5 bg-slate-800/20 p-3">
      <p class="text-xs text-slate-400">
        Events are retained for a limited period and pruned periodically. Older events may no longer
        be available.
      </p>
    </div>

    {#if loading}
      <div class="mt-6 flex items-center justify-center py-12">
        <div class="text-sm text-slate-400">Loading audit events...</div>
      </div>
    {:else if error}
      <div class="mt-6 rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">
        {error}
      </div>
    {:else if events.length === 0}
      <div class="mt-6 flex flex-col items-center justify-center py-12 text-center">
        <div class="text-sm text-slate-400">No audit events recorded yet.</div>
        <div class="mt-1 text-xs text-slate-500">
          Events will appear here as actions are performed on the manager.
        </div>
      </div>
    {:else}
      <div class="mt-6 overflow-x-auto">
        <table class="w-full text-left text-sm">
          <thead>
            <tr class="border-b border-white/10 text-xs uppercase text-slate-400">
              <th class="pb-3 pr-4 font-medium">Type</th>
              <th class="pb-3 pr-4 font-medium">Actor</th>
              <th class="pb-3 pr-4 font-medium">Action</th>
              <th class="pb-3 pr-4 font-medium">Details</th>
              <th class="pb-3 font-medium">Date</th>
            </tr>
          </thead>
          <tbody>
            {#each events as event (event.id)}
              <tr class="border-b border-white/5 text-slate-300">
                <td class="py-3 pr-4">
                  <span
                    class="inline-flex rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-300"
                  >
                    {event.eventType}
                  </span>
                </td>
                <td class="py-3 pr-4 text-slate-400">
                  {event.actorUserId ?? '—'}
                </td>
                <td class="py-3 pr-4 font-mono text-xs">
                  {event.action ?? '—'}
                </td>
                <td class="py-3 pr-4 text-xs text-slate-400">
                  {formatDetails(event.details)}
                </td>
                <td class="py-3 text-xs text-slate-400">
                  {formatDate(event.createdAt)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>

      <div class="mt-6 flex justify-center">
        <button
          onclick={loadMore}
          disabled={loadingMore}
          class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loadingMore ? 'Loading...' : 'Load more'}
        </button>
      </div>
    {/if}
  </div>
</div>
