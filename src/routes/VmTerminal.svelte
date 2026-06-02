<script lang="ts">
  import { onMount } from 'svelte';
  import { AlertCircle, Loader2, Maximize2, PlugZap, Terminal } from '@lucide/svelte';

  let { machineName }: { machineName: string } = $props();

  let socket: WebSocket | null = null;
  let confirmed = $state(false);
  let connected = $state(false);
  let connecting = $state(false);
  let error: string | null = $state(null);
  let output: string[] = $state([]);
  let command = $state('');
  let cols = $state(100);
  let rows = $state(28);

  const terminalUrl = $derived(() => {
    if (typeof window === 'undefined') return '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({ cols: String(cols), rows: String(rows) });
    return `${protocol}//${window.location.host}/api/smolvm/machines/${encodeURIComponent(machineName)}/terminal/ws?${params.toString()}`;
  });

  function appendOutput(value: string) {
    output = [...output, value].slice(-500);
  }

  function sendFrame(frame: Record<string, unknown>) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  }

  function sendResize() {
    sendFrame({ type: 'resize', cols, rows });
  }

  function closeTerminal() {
    sendFrame({ type: 'close' });
    socket?.close(1000, 'Closed by user');
    socket = null;
    connected = false;
    connecting = false;
  }

  function openTerminal() {
    closeTerminal();
    confirmed = true;
    connecting = true;
    error = null;
    output = [];

    const nextSocket = new WebSocket(terminalUrl());
    nextSocket.binaryType = 'arraybuffer';
    socket = nextSocket;

    nextSocket.addEventListener('open', () => {
      connected = true;
      connecting = false;
      appendOutput('Terminal session opened.');
      sendResize();
    });

    nextSocket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') {
        appendOutput(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        appendOutput(new TextDecoder().decode(event.data));
      }
    });

    nextSocket.addEventListener('close', (event) => {
      connected = false;
      connecting = false;
      if (event.code !== 1000) {
        error = `Terminal disconnected (${event.code || 'no close code'}).`;
      }
    });

    nextSocket.addEventListener('error', () => {
      error = 'Terminal connection failed.';
      connecting = false;
      connected = false;
    });
  }

  function sendCommand() {
    if (!connected || !command.trim()) return;
    sendFrame({ type: 'stdin', data: `${command}\n` });
    command = '';
  }

  onMount(() => closeTerminal);
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h3 class="flex items-center gap-2 text-lg font-medium text-white">
        <Terminal size={18} class="text-cyan-300" />
        Browser terminal
      </h3>
      <p class="text-sm text-slate-400">
        Interactive PTY access streams through the authenticated manager proxy.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <span
        class="inline-flex items-center gap-1 rounded-full border border-white/10 bg-slate-800 px-3 py-1 text-xs text-slate-300"
      >
        {#if connecting}
          <Loader2 size={12} class="animate-spin" />
        {:else}
          <PlugZap size={12} />
        {/if}
        {connected ? 'Connected' : connecting ? 'Connecting' : 'Closed'}
      </span>
      {#if connected || connecting}
        <button
          class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 transition hover:bg-red-500/20"
          onclick={closeTerminal}
        >
          Close terminal
        </button>
      {/if}
    </div>
  </div>

  {#if !confirmed}
    <div class="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
      <p class="text-sm text-amber-100">
        Opening a terminal grants interactive access to <strong>{machineName}</strong>. Audit
        records store only metadata: machine name, event type, timestamp, actor, and error code.
      </p>
      <button
        class="mt-3 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500"
        onclick={openTerminal}
      >
        I understand, open terminal
      </button>
    </div>
  {/if}

  {#if error}
    <div
      class="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200"
    >
      <AlertCircle size={16} />
      {error}
      <button class="ml-auto text-cyan-200 underline" onclick={openTerminal}>Reconnect</button>
    </div>
  {/if}

  <div class="flex flex-col gap-3 rounded-xl border border-white/10 bg-slate-950 p-4">
    <pre
      aria-label="Terminal output"
      class="min-h-72 overflow-auto font-mono text-xs leading-5 text-slate-200">{output.length
        ? output.join('')
        : 'Terminal is closed.'}</pre>
    <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
      <input
        class="flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-2 font-mono text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none disabled:opacity-50"
        placeholder="Type a command..."
        bind:value={command}
        disabled={!connected}
        onkeydown={(event) => {
          if (event.key === 'Enter') sendCommand();
        }}
      />
      <button
        class="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:opacity-50"
        onclick={sendCommand}
        disabled={!connected || !command.trim()}
      >
        Send
      </button>
      <label class="flex items-center gap-2 text-xs text-slate-400">
        <Maximize2 size={14} />
        <input
          class="w-16 rounded bg-slate-900 px-2 py-1 text-slate-200"
          type="number"
          min="20"
          bind:value={cols}
          onchange={sendResize}
          aria-label="Terminal columns"
        />
        ×
        <input
          class="w-16 rounded bg-slate-900 px-2 py-1 text-slate-200"
          type="number"
          min="5"
          bind:value={rows}
          onchange={sendResize}
          aria-label="Terminal rows"
        />
      </label>
    </div>
  </div>
</div>
