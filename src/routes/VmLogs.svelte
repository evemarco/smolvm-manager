<script lang="ts">
  import { onMount } from 'svelte';
  import { AlertCircle, Loader2, PlugZap, RefreshCw } from '@lucide/svelte';

  let { machineName }: { machineName: string } = $props();

  const tail = 200;
  const maxLines = 500;

  let lines: string[] = $state([]);
  let connected = $state(false);
  let connecting = $state(false);
  let error: string | null = $state(null);
  let reconnecting = $state(false);
  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closedByUser = false;

  function appendLine(line: string) {
    lines = [...lines, line].slice(-maxLines);
  }

  function closeSource() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    source?.close();
    source = null;
    connected = false;
    connecting = false;
  }

  function connect() {
    closeSource();
    closedByUser = false;
    connecting = true;
    error = null;

    source = new EventSource(
      `/api/smolvm/machines/${encodeURIComponent(machineName)}/logs?tail=${tail}&follow=1`
    );

    source.addEventListener('ready', () => {
      connected = true;
      connecting = false;
      reconnecting = false;
    });

    source.addEventListener('log', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as { line?: string };
      if (payload.line) appendLine(payload.line);
    });

    source.addEventListener('error', () => {
      source?.close();
      connected = false;
      connecting = false;

      if (!closedByUser) {
        error = 'Log stream disconnected. Reconnecting...';
        reconnecting = true;
        reconnectTimer = setTimeout(connect, 1500);
      }
    });
  }

  function pause() {
    closedByUser = true;
    closeSource();
    error = null;
    reconnecting = false;
  }

  onMount(() => {
    connect();
    return pause;
  });
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h3 class="text-lg font-medium text-white">Live logs</h3>
      <p class="text-sm text-slate-400">
        Loading the last {tail} lines, then following new output.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <span
        class="inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs {connected
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}"
      >
        {#if connecting || reconnecting}
          <Loader2 size={12} class="animate-spin" />
        {:else}
          <PlugZap size={12} />
        {/if}
        {connected
          ? 'Following'
          : reconnecting
            ? 'Reconnecting'
            : connecting
              ? 'Connecting'
              : 'Paused'}
      </span>
      <button
        class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
        onclick={connected || connecting ? pause : connect}
      >
        <RefreshCw size={14} />
        {connected || connecting ? 'Pause' : 'Reconnect'}
      </button>
    </div>
  </div>

  {#if error}
    <div
      class="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
    >
      <AlertCircle size={16} />
      {error}
    </div>
  {/if}

  <pre
    aria-label="Log output"
    class="min-h-80 overflow-auto rounded-xl border border-white/10 bg-slate-950 p-4 font-mono text-xs leading-5 text-slate-200">{lines.length
      ? lines.join('\n')
      : 'Waiting for log output...'}</pre>
</div>
