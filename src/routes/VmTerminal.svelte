<script lang="ts">
  import { AlertCircle, Loader2, PlugZap, Terminal as TerminalIcon } from '@lucide/svelte';
  import { getTerminalSession } from '$lib/client/terminal-sessions.svelte';
  import { untrack } from 'svelte';
  import type { Attachment } from 'svelte/attachments';
  import '@xterm/xterm/css/xterm.css';

  let { machineName }: { machineName: string } = $props();
  let session = $derived.by(() => {
    const currentMachineName = machineName;
    return untrack(() => getTerminalSession(currentMachineName));
  });
  let attachTerminal = $derived.by<Attachment<HTMLDivElement>>(() => {
    const activeSession = session;
    return (container) => {
      activeSession.attach(container);
      return () => {
        activeSession.detach(container);
      };
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
        {#if session.connecting}
          <Loader2 size={12} class="animate-spin" />
        {:else}
          <PlugZap size={12} />
        {/if}
        {session.connected ? 'Connected' : session.connecting ? 'Connecting' : 'Closed'}
      </span>
      {#if session.connected || session.connecting}
        <button
          class="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300 transition hover:bg-red-500/20"
          onclick={() => session.close()}
        >
          Close terminal
        </button>
      {/if}
    </div>
  </div>

  {#if !session.confirmed}
    <div class="rounded-xl border border-amber-500/20 bg-amber-500/10 p-4">
      <p class="text-sm text-amber-100">
        Opening a terminal grants interactive access to <strong>{machineName}</strong>. Audit
        records store only metadata: machine name, event type, timestamp, actor, and error code.
      </p>
      <button
        class="mt-3 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500"
        onclick={() => session.open()}
      >
        I understand, open terminal
      </button>
    </div>
  {/if}

  {#if session.error}
    <div
      class="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200"
    >
      <AlertCircle size={16} />
      {session.error}
      <button class="ml-auto text-cyan-200 underline" onclick={() => session.open()}>Reconnect</button>
    </div>
  {/if}

  {#if session.exitCode !== null}
    <div
      class="rounded-lg border border-slate-500/20 bg-slate-800/50 px-3 py-2 text-sm text-slate-300"
    >
      Process exited with code <strong class="text-white">{session.exitCode}</strong>.
    </div>
  {/if}

  <div class="rounded-xl border border-white/10 bg-slate-950 p-4">
    <div
      data-testid="xterm-container"
      class="xterm-container min-h-72 overflow-hidden"
      {@attach attachTerminal}
    ></div>
    {#if session.confirmed && !session.connected && !session.connecting}
      <p class="mt-2 text-center text-xs text-slate-500">Terminal is closed.</p>
    {/if}
  </div>
</div>
