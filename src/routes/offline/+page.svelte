<svelte:head>
  <title>Offline - SmolVM Manager</title>
</svelte:head>

<div class="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-10">
  <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-8 shadow-xl">
    <h1 class="text-2xl font-semibold text-white">You are offline</h1>
    <p class="mt-2 text-sm text-slate-400">
      The manager cannot reach the server right now. Live VM data and actions require a
      connection to the host running SmolVM.
    </p>
    <button
      type="button"
      onclick={() => window.location.reload()}
      class="mt-6 rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-400"
    >
      Retry
    </button>
  </div>
</div>
