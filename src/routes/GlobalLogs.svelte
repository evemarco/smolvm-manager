<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import { AlertCircle, Loader2, Pause, Play, PlugZap } from '@lucide/svelte';

  const tail = 100;
  const maxLines = 500;
  const machinePalette = [
    'text-cyan-300',
    'text-amber-300',
    'text-violet-300',
    'text-emerald-300',
    'text-rose-300',
    'text-sky-300'
  ] as const;

  type LogEntry =
    | { readonly kind: 'line'; readonly machine: string; readonly line: string }
    | { readonly kind: 'gap'; readonly machine: string; readonly dropped: number };

  let entries: LogEntry[] = $state([]);
  const machines = new SvelteMap<string, 'online' | 'offline' | 'removed'>();
  let connected = $state(false);
  let connecting = $state(false);
  let reconnecting = $state(false);
  let error: string | null = $state(null);
  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closedByUser = false;

  function colorFor(name: string): string {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = (hash * 31 + name.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % machinePalette.length;
    return machinePalette[idx];
  }

  function append(entry: LogEntry) {
    entries = [...entries, entry].slice(-maxLines);
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

    source = new EventSource(`/api/smolvm/logs?tail=${tail}&follow=1`);

    source.addEventListener('ready', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        machines?: string[];
      };
      machines.clear();
      for (const name of payload.machines ?? []) machines.set(name, 'online');
      connected = true;
      connecting = false;
      reconnecting = false;
    });

    source.addEventListener('log', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        machine?: string;
        line?: string;
      };
      if (payload.machine && payload.line) {
        append({ kind: 'line', machine: payload.machine, line: payload.line });
        if (!machines.has(payload.machine)) {
          machines.set(payload.machine, 'online');
        }
      }
    });

    source.addEventListener('machine', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        name?: string;
        state?: string;
      };
      if (!payload.name) return;
      if (payload.state === 'added' || payload.state === 'online') {
        machines.set(payload.name, 'online');
      } else if (payload.state === 'offline') {
        machines.set(payload.name, 'offline');
      } else if (payload.state === 'removed') {
        machines.set(payload.name, 'removed');
      }
    });

    source.addEventListener('gap', (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as {
        machine?: string;
        dropped?: number;
      };
      if (payload.machine && payload.dropped && payload.dropped > 0) {
        append({ kind: 'gap', machine: payload.machine, dropped: payload.dropped });
      }
    });

    source.addEventListener('error', (event) => {
      const messageEvent = event as MessageEvent;
      let serverMessage: string | null = null;
      try {
        if (messageEvent.data) {
          const payload = JSON.parse(messageEvent.data) as { message?: string };
          serverMessage = payload.message ?? null;
        }
      } catch {
        // ignore parse errors; fall through to generic handling
      }

      source?.close();
      connected = false;
      connecting = false;

      if (!closedByUser) {
        error = serverMessage ?? 'Log stream disconnected. Reconnecting...';
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

<section
  data-testid="global-logs-panel"
  class="rounded-2xl border border-white/10 bg-slate-900/70 p-4 sm:p-5"
>
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h3 class="text-lg font-medium text-white">Global logs</h3>
      <p class="text-sm text-slate-400">
        Aggregated output from every machine, last {tail} lines each.
      </p>
    </div>
    <div class="flex flex-wrap items-center gap-2">
      {#each [...machines.entries()] as [name, state] (name)}
        {#if state !== 'removed'}
          <span
            data-testid="machine-badge-{name}"
            class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium {state ===
            'online'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
              : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}"
          >
            <span
              class="inline-block size-1.5 rounded-full {state === 'online'
                ? 'bg-emerald-400'
                : 'bg-amber-400'}"
            ></span>
            {name}
            <span class="text-[10px] uppercase tracking-wider opacity-70">{state}</span>
          </span>
        {/if}
      {/each}
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
        type="button"
        class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
        onclick={connected || connecting ? pause : connect}
      >
        {#if connected || connecting}
          <Pause size={14} />
          Pause
        {:else}
          <Play size={14} />
          Resume
        {/if}
      </button>
    </div>
  </div>

  {#if error}
    <div
      class="mt-3 flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-200"
    >
      <AlertCircle size={16} />
      {error}
    </div>
  {/if}

  <pre
    aria-label="Global log output"
    class="mt-4 min-h-80 overflow-auto rounded-xl border border-white/10 bg-slate-950 p-4 font-mono text-xs leading-5">
    {#if entries.length === 0}
      <span class="text-slate-500">Waiting for log output...</span>
    {:else}
      {#each entries as entry, i (i)}
        {#if entry.kind === 'line'}
          <span data-machine={entry.machine} class={colorFor(entry.machine)}
            ><span class="text-slate-500">[{entry.machine}]</span> {entry.line}</span
          ><!-- eslint-disable-line svelte/no-useless-mustaches -->{'\n'}
        {:else}
          <span data-machine={entry.machine} class="text-slate-500 italic"
            >… {entry.dropped} {entry.dropped === 1 ? 'line' : 'lines'} dropped on {entry.machine}
            …</span
          ><!-- eslint-disable-line svelte/no-useless-mustaches -->{'\n'}
        {/if}
      {/each}
    {/if}
  </pre>
</section>
