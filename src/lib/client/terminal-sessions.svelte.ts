import { browser } from '$app/environment';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { SvelteMap } from 'svelte/reactivity';

declare global {
  interface Window {
    __xtermTerm?: Terminal;
  }
}

type TerminalRenderer = {
  readonly term: Terminal;
  readonly fitAddon: FitAddon;
};

export class TerminalSession {
  readonly machineName: string;

  confirmed = $state(false);
  connected = $state(false);
  connecting = $state(false);
  error: string | null = $state(null);
  exitCode: number | null = $state(null);

  #socket: WebSocket | null = null;
  #renderer: TerminalRenderer | null = null;
  #container: HTMLDivElement | null = null;
  #resizeObserver: ResizeObserver | null = null;
  #openGeneration = 0;

  constructor(machineName: string) {
    this.machineName = machineName;
  }

  attach(container: HTMLDivElement): void {
    this.#container = container;
    const root = this.#renderer?.term.element;
    if (root && root.parentElement !== container) container.replaceChildren(root);
    if (this.#renderer) {
      window.__xtermTerm = this.#renderer.term;
      this.#observeContainer();
      requestAnimationFrame(() => {
        if (this.#container !== container || !this.#renderer) return;
        this.#renderer.fitAddon.fit();
        this.#sendResize();
      });
    }
  }

  detach(container: HTMLDivElement): void {
    if (this.#container !== container) return;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#container = null;
  }

  async open(): Promise<void> {
    const container = this.#container;
    if (!container) return;

    const generation = ++this.#openGeneration;
    this.#closeSocket();
    this.#disposeRenderer();
    this.confirmed = true;
    this.connecting = true;
    this.error = null;
    this.exitCode = null;

    try {
      this.#renderer = await this.#createRenderer(container);
    } catch (cause) {
      if (generation !== this.#openGeneration) return;
      this.error =
        cause instanceof Error
          ? `Failed to initialize terminal renderer: ${cause.message}`
          : 'Failed to initialize terminal renderer.';
      this.connecting = false;
      return;
    }

    if (generation !== this.#openGeneration) {
      this.#disposeRenderer();
      return;
    }

    window.__xtermTerm = this.#renderer.term;
    this.#renderer.term.onData((data: string) => {
      this.#sendFrame({ type: 'stdin', data });
    });
    this.#observeContainer();

    const socket = new WebSocket(this.#terminalUrl());
    socket.binaryType = 'arraybuffer';
    this.#socket = socket;

    socket.addEventListener('open', () => {
      if (this.#socket !== socket) return;
      this.connected = true;
      this.connecting = false;
      this.#sendResize();
    });
    socket.addEventListener('message', (event) => {
      if (this.#socket !== socket) return;
      if (event.data instanceof ArrayBuffer || typeof event.data === 'string') {
        this.#handleInbound(event.data);
      }
    });
    socket.addEventListener('close', (event) => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.connected = false;
      this.connecting = false;
      if (event.code !== 1000) {
        this.error = `Terminal disconnected (${event.code || 'no close code'}).`;
      }
    });
    socket.addEventListener('error', () => {
      if (this.#socket !== socket) return;
      this.error = 'Terminal connection failed.';
      this.connecting = false;
      this.connected = false;
    });
  }

  close(): void {
    this.#openGeneration += 1;
    this.#sendFrame({ type: 'close' });
    this.#closeSocket();
    this.#disposeRenderer();
    this.connected = false;
    this.connecting = false;
  }

  async #createRenderer(container: HTMLElement): Promise<TerminalRenderer> {
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

  #terminalUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const cols = this.#renderer?.term.cols ?? 80;
    const rows = this.#renderer?.term.rows ?? 24;
    const params = new URLSearchParams({ cols: String(cols), rows: String(rows) });
    return `${protocol}//${window.location.host}/api/smolvm/machines/${encodeURIComponent(this.machineName)}/terminal/ws?${params.toString()}`;
  }

  #sendFrame(frame: Record<string, unknown>): void {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(JSON.stringify(frame));
  }

  #sendResize(): void {
    const term = this.#renderer?.term;
    this.#sendFrame({ type: 'resize', cols: term?.cols ?? 80, rows: term?.rows ?? 24 });
  }

  #handleInbound(data: ArrayBuffer | string): void {
    const term = this.#renderer?.term;
    if (!term) return;
    if (data instanceof ArrayBuffer) {
      term.write(new Uint8Array(data));
      return;
    }
    try {
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed === 'object' && parsed !== null && 'type' in parsed && parsed.type === 'exit') {
        const code = 'code' in parsed && typeof parsed.code === 'number' ? parsed.code : 0;
        this.exitCode = code;
        term.write(`\r\n[Process exited with code ${code}]\r\n`);
        return;
      }
    } catch (cause) {
      if (!(cause instanceof SyntaxError)) throw cause;
    }
    term.write(data);
  }

  #observeContainer(): void {
    const container = this.#container;
    if (!container || !this.#renderer) return;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = new ResizeObserver(() => {
      if (!this.#renderer || this.#container !== container) return;
      this.#renderer.fitAddon.fit();
      this.#sendResize();
    });
    this.#resizeObserver.observe(container);
  }

  #closeSocket(): void {
    const socket = this.#socket;
    this.#socket = null;
    socket?.close(1000, 'Closed by user');
  }

  #disposeRenderer(): void {
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = null;
    this.#renderer?.term.dispose();
    this.#renderer = null;
    if (window.__xtermTerm) delete window.__xtermTerm;
  }
}

const terminalSessions = new SvelteMap<string, TerminalSession>();

export function getTerminalSession(machineName: string): TerminalSession {
  if (!browser) return new TerminalSession(machineName);
  const existing = terminalSessions.get(machineName);
  if (existing) return existing;
  const session = new TerminalSession(machineName);
  terminalSessions.set(machineName, session);
  return session;
}
