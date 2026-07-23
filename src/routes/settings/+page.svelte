<script lang="ts">
  import { ExternalLink, Shield, AlertCircle } from '@lucide/svelte';

  let { form, data } = $props();
</script>

<svelte:head>
  <title>Settings - SmolVM Manager</title>
</svelte:head>

<div class="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-10">
  <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-8 shadow-xl">
    <div class="flex items-start gap-3">
      <div class="mt-1 flex size-10 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
        <Shield size={20} class="text-cyan-400" />
      </div>
      <div class="flex-1">
        <h1 class="text-xl font-semibold text-white">Docker Hub</h1>
        <p class="mt-1 text-sm text-slate-400">
          Configure authentication for Docker Hub image searches.
        </p>
      </div>
    </div>

    <div class="mt-6 rounded-lg border border-white/10 bg-slate-800/40 p-4">
      <div class="flex items-center gap-2">
        <span class="text-sm font-medium text-slate-300">Status:</span>
        {#if data.storedTokenSet}
          <span
            class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300"
          >
            Token configured for {data.storedUsername} (ends with {data.storedTokenPreview})
          </span>
        {:else if data.envTokenSet}
          <span
            class="inline-flex items-center gap-1 rounded-full bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-400"
          >
            Token provided by server environment
          </span>
        {:else}
          <span
            class="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-medium text-amber-300"
          >
            <AlertCircle size={12} />
            Anonymous mode — no token configured
          </span>
        {/if}
      </div>
    </div>

    <form method="POST" action="?/save" class="mt-6 flex flex-col gap-4">
      {#if form?.error}
        <div class="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {form.error}
        </div>
      {/if}

      <div class="flex flex-col gap-1">
        <label for="username" class="text-sm font-medium text-slate-300">Docker Hub username</label>
        <input
          id="username"
          name="username"
          type="text"
          autocomplete="username"
          required
          value={data.storedUsername ?? ''}
          class="rounded-lg border border-white/10 bg-slate-950 px-4 py-2 text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
          placeholder="your-username"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label for="token" class="text-sm font-medium text-slate-300">Access Token</label>
        <input
          id="token"
          name="token"
          type="password"
          autocomplete="off"
          required
          class="rounded-lg border border-white/10 bg-slate-950 px-4 py-2 text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
          placeholder="dckr_pat_…"
        />
      </div>

      <input type="hidden" name="csrf" value={data.csrfToken ?? ''} />

      <button
        type="submit"
        class="rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-400"
      >
        Save Token
      </button>
    </form>

    {#if data.storedTokenSet}
      <form method="POST" action="?/clear" class="mt-4">
        <input type="hidden" name="csrf" value={data.csrfToken ?? ''} />
        <button
          type="submit"
          class="rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
        >
          Remove Token
        </button>
      </form>
    {/if}

    <div class="mt-8 rounded-lg border border-white/5 bg-slate-800/20 p-4">
      <p class="text-xs text-slate-400">
        <!-- eslint-disable svelte/no-navigation-without-resolve -->
        <a
          href="https://hub.docker.com/settings/security"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center gap-1 text-cyan-400 transition hover:text-cyan-300"
        >
          Create a Personal Access Token on Docker Hub
          <ExternalLink size={12} />
        </a>
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
      </p>
      <p class="mt-2 text-xs text-slate-500">
        The token must be a Personal Access Token (PAT) created at the link above, used together
        with your Docker Hub username. The manager exchanges the username and token for a session
        JWT server-side — the raw PAT is never sent directly to Docker Hub as a Bearer credential.
      </p>
    </div>
  </div>
</div>
