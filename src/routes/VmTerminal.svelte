<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';
  import { AlertCircle, Loader2, PlugZap, Terminal as TerminalIcon } from '@lucide/svelte';
  import '@xterm/xterm/css/xterm.css';

  let { machineName }: { machineName: string } = $props();

  let socket: WebSocket | null = $state(null);
  let confirmed = $state(false);
  let connected = $state(false);
  let connecting = $state(false);
  let error: string | null = $state(null);
  let exitCode: number | null = $state(null);
  let cols = $state(80);
  let rows = $state(24);

  let containerEl: HTMLDivElement | undefined = $state(undefined);
  let termInstance: Awaited<ReturnType<typeof createTerminal>> | null = null;
  let resizeObserver: ResizeObserver | null = null;

  const terminalUrl = $derived(() => {
    if (!browser) return '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({ cols: String(cols), rows: String(rows) });
    return `${protocol}//${window.location.host}/api/smolvm/machines/${encodeURIComponent(machineName)}/terminal/ws?${params.toString()}`;
  });

  async function createTerminal(container: HTMLElement) {
    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit')
    ]);

    const fitAddon = new FitAddon();
    const term = new Terminal({
      fontSize: 13,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      theme: {
        background: '#020617',
        foreground: '#e2e8f0',
        cursor: '#22d3ee',
        cursorAccent: '#020617',
        selectionBackground: 'rgba(34, 211, 238, 0.3)',
        selectionForeground: '#f8fafc',
        black: '#1e293b',
        red: '#f87171',
        green: '#4ade80',
        yellow: '#facc15',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e2e8f0',
        brightBlack: '#475569',
        brightRed: '#fca5a5',
        brightGreen: '#86efac',
        brightYellow: '#fde047',
        brightBlue: '#93c5fd',
        brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9',
        brightWhite: '#f8fafc'
      },
      allowProposedApi: true
    });

    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    return { term, fitAddon };
  }

  function sendFrame(frame: Record<string, unknown>) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
  }

  function sendResize() {
    if (termInstance) {
      sendFrame({ type: 'resize', cols: termInstance.term.cols, rows: termInstance.term.rows });
    } else {
      sendFrame({ type: 'resize', cols, rows });
    }
  }

  function closeTerminal() {
    sendFrame({ type: 'close' });
    socket?.close(1000, 'Closed by user');
    socket = null;
    connected = false;
    connecting = false;
  }

  function disposeTerminal() {
    resizeObserver?.disconnect();
    resizeObserver = null;
    termInstance?.term.dispose();
    termInstance = null;
  }

  let openGeneration = 0;

  function handleInbound(data: ArrayBuffer | string) {
    if (!termInstance) return;
    if (data instanceof ArrayBuffer) {
      termInstance.term.write(new Uint8Array(data));
      return;
    }
    try {
      const parsed = JSON.parse(data) as { type?: string; code?: number };
      if (parsed?.type === 'exit') {
        exitCode = typeof parsed.code === 'number' ? parsed.code : 0;
        termInstance.term.write(`\r\n[Process exited with code ${exitCode}]\r\n`);
        return;
      }
    } catch {
      // Not JSON — printable text
    }
    termInstance.term.write(data);
  }

  async function openTerminal() {
    const generation = ++openGeneration;
    closeTerminal();
    disposeTerminal();
    confirmed = true;
    connecting = true;
    error = null;
    exitCode = null;

    // Create terminal renderer FIRST (browser-only, dynamic imports)
    if (browser && containerEl) {
      try {
        const created = await createTerminal(containerEl);
        if (generation !== openGeneration) {
          created.term.dispose();
          return;
        }
        termInstance = created;
        termInstance.term.onData((data: string) => {
          sendFrame({ type: 'stdin', data });
        });
        (window as unknown as Record<string, unknown>).__xtermTerm = termInstance.term;

        resizeObserver = new ResizeObserver(() => {
          if (!termInstance) return;
          termInstance.fitAddon.fit();
          sendResize();
        });
        resizeObserver.observe(containerEl);
      } catch {
        error = 'Failed to initialize terminal renderer.';
        connecting = false;
        return;
      }
    }

    const nextSocket = new WebSocket(terminalUrl());
    nextSocket.binaryType = 'arraybuffer';
    socket = nextSocket;

    nextSocket.addEventListener('open', () => {
      connected = true;
      connecting = false;
      sendResize();
    });

    nextSocket.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) {
        handleInbound(event.data);
        return;
      }
      if (typeof event.data === 'string') {
        handleInbound(event.data);
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

  onMount(() => {
    return () => {
      openGeneration += 1;
      closeTerminal();
      disposeTerminal();
    };
  });
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h3 class="flex items-center gap-2 text-lg font-medium text-white">
        <TerminalIcon size={18} class="text-cyan-300" />
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

  {#if exitCode !== null}
    <div
      class="rounded-lg border border-slate-500/20 bg-slate-800/50 px-3 py-2 text-sm text-slate-300"
    >
      Process exited with code <strong class="text-white">{exitCode}</strong>.
    </div>
  {/if}

  <div class="rounded-xl border border-white/10 bg-slate-950 p-4">
    <div
      data-testid="xterm-container"
      class="xterm-container min-h-72 overflow-hidden"
      bind:this={containerEl}
    ></div>
    {#if confirmed && !connected && !connecting}
      <p class="mt-2 text-center text-xs text-slate-500">Terminal is closed.</p>
    {/if}
  </div>
</div>
