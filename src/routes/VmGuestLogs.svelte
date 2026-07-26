<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteURLSearchParams } from 'svelte/reactivity';
  import { AlertCircle, FileText, RefreshCw, Terminal } from '@lucide/svelte';

  let { machineName }: { machineName: string } = $props();

  type LogEntry = {
    stream: 'stdout' | 'stderr';
    text: string;
  };

  const maxLines = 500;
  const tail = 200;

  type Preset = { label: string; source: 'journalctl' | 'file'; path?: string };

  const presets: Preset[] = [
    { label: 'journalctl', source: 'journalctl' },
    { label: '/var/log/syslog', source: 'file', path: '/var/log/syslog' },
    { label: '/var/log/kern.log', source: 'file', path: '/var/log/kern.log' }
  ];

  let entries: LogEntry[] = $state([]);
  let exitCode: number | null = $state(null);
  let error: string | null = $state(null);
  let connecting = $state(false);
  let activeSource: string | null = $state(null);
  let customPath = $state('');
  let customPathError = $state('');
  let source: EventSource | null = $state(null);

  function appendEntry(entry: LogEntry) {
    entries = [...entries, entry].slice(-maxLines);
  }

  function closeSource() {
    source?.close();
    source = null;
    connecting = false;
  }

  function validatePath(path: string): boolean {
    if (!path.startsWith('/var/log/')) return false;
    if (path.includes('\0')) return false;
    if (path.split('/').some((segment) => segment === '..')) return false;
    return true;
  }

  function buildUrl(sourceType: 'journalctl' | 'file', filePath?: string): string {
    const params = new SvelteURLSearchParams({ source: sourceType, tail: String(tail) });
    if (sourceType === 'file' && filePath) params.set('path', filePath);
    return `/api/smolvm/machines/${encodeURIComponent(machineName)}/guest-logs?${params.toString()}`;
  }

  function connect(sourceType: 'journalctl' | 'file', filePath?: string) {
    closeSource();
    entries = [];
    exitCode = null;
    error = null;
    connecting = true;
    activeSource = filePath ?? sourceType;

    const es = new EventSource(buildUrl(sourceType, filePath));
    source = es;
    let finished = false;

    es.addEventListener('line', (event: Event) => {
      if (finished) return;
      const payload = JSON.parse((event as MessageEvent).data) as {
        stream?: 'stdout' | 'stderr';
        text?: string;
      };
      if (payload.stream && payload.text != null) {
        appendEntry({ stream: payload.stream, text: payload.text });
      }
    });

    es.addEventListener('exit', (event: Event) => {
      finished = true;
      const payload = JSON.parse((event as MessageEvent).data) as { code?: number };
      exitCode = payload.code ?? null;
      connecting = false;
      closeSource();
    });

    es.addEventListener('error', (event: Event) => {
      // SSE server-sent `error` event has data; DOM `error` event (connection failure) does not.
      if ((event as MessageEvent).data) {
        finished = true;
        const payload = JSON.parse((event as MessageEvent).data) as { message?: string };
        error = payload.message ?? 'Guest log stream error.';
        connecting = false;
        closeSource();
      }
      // DOM error from connection close is handled by onerror below
    });

    es.onerror = () => {
      if (finished) return;
      if (es.readyState === EventSource.CLOSED) {
        error = 'Could not start guest log stream. The VM may be unavailable.';
        connecting = false;
        closeSource();
      }
    };
  }

  function selectPreset(preset: Preset) {
    connect(preset.source, preset.path);
  }

  function submitCustomPath() {
    if (!validatePath(customPath)) {
      customPathError = 'Path must start with /var/log/ and contain no traversal.';
      return;
    }
    customPathError = '';
    connect('file', customPath);
  }

  function retry() {
    if (activeSource === 'journalctl') {
      connect('journalctl');
    } else if (activeSource) {
      connect('file', activeSource);
    }
  }

  onMount(() => closeSource);
</script>

<div class="flex flex-col gap-4">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h3 class="flex items-center gap-2 text-lg font-medium text-white">
        <Terminal size={18} class="text-cyan-300" />
        Guest logs
      </h3>
      <p class="text-sm text-slate-400">
        Stream logs from inside the VM guest. Pick a source to begin.
      </p>
    </div>
    {#if connecting}
      <span
        class="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs text-amber-300"
      >
        Connecting...
      </span>
    {/if}
  </div>

  <!-- Presets -->
  <div class="flex flex-wrap items-center gap-2">
    {#each presets as preset (preset.label)}
      <button
        class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white {activeSource ===
        (preset.path ?? preset.source)
          ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
          : ''}"
        onclick={() => selectPreset(preset)}
      >
        <FileText size={14} />
        {preset.label}
      </button>
    {/each}
  </div>

  <!-- Custom path -->
  <div class="flex flex-col gap-1">
    <label class="flex items-center gap-2 text-xs text-slate-400">
      Custom path
      <input
        class="flex-1 rounded-lg border border-white/10 bg-slate-900 px-3 py-1.5 font-mono text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
        type="text"
        placeholder="/var/log/..."
        bind:value={customPath}
        onkeydown={(e) => {
          if (e.key === 'Enter') submitCustomPath();
        }}
      />
      <button
        class="rounded-lg bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-cyan-500"
        onclick={submitCustomPath}
      >
        Stream
      </button>
    </label>
    {#if customPathError}
      <p class="text-xs text-amber-300">{customPathError}</p>
    {/if}
  </div>

  <!-- Error state -->
  {#if error}
    <div
      class="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200"
    >
      <AlertCircle size={16} />
      <span>The guest log stream is unavailable or the VM is not running.</span>
      <button
        class="ml-auto flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-xs text-cyan-200 transition hover:bg-slate-700"
        onclick={retry}
      >
        <RefreshCw size={12} />
        Retry
      </button>
    </div>
  {/if}

  <!-- Exit banner -->
  {#if exitCode !== null}
    <div
      class="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2 text-sm text-slate-300"
    >
      Exit code {exitCode}.
    </div>
  {/if}

  <!-- Log output -->
  <pre
    aria-label="Guest log output"
    class="min-h-80 overflow-auto rounded-xl border border-white/10 bg-slate-950 p-4 font-mono text-xs leading-5">{#if entries.length === 0 && !error}Waiting for guest log output...{:else}{#each entries as entry, i (i)}<span
          class={entry.stream === 'stderr' ? 'text-amber-300' : 'text-slate-200'}
          >{entry.text}
</span>{/each}{/if}</pre>
</div>
