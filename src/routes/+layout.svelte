<script lang="ts">
  import favicon from '$lib/assets/favicon.svg';
  import '../app.css';

  let { children, data } = $props();
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <meta name="theme-color" content="#020617" />
</svelte:head>

{#if data.admin}
  <header class="border-b border-white/10 bg-slate-900/80 px-6 py-3 backdrop-blur">
    <div class="mx-auto flex max-w-6xl items-center justify-between">
      <span class="text-sm font-medium text-white">SmolVM Manager</span>
      <div class="flex items-center gap-4">
        <span class="text-sm text-slate-400">{data.admin.email}</span>
        <form method="POST" action="/logout" class="inline">
          <input type="hidden" name="csrf" value={data.csrfToken ?? ''} />
          <button
            type="submit"
            class="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
          >
            Logout
          </button>
        </form>
      </div>
    </div>
  </header>
{/if}

{@render children()}
