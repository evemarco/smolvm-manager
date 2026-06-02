<script lang="ts">
  let { form, data } = $props();
</script>

<svelte:head>
  <title>Login - SmolVM Manager</title>
</svelte:head>

<main class="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-10">
  <div class="rounded-2xl border border-white/10 bg-slate-900/60 p-8 shadow-xl">
    <h1 class="text-2xl font-semibold text-white">Sign In</h1>
    <p class="mt-2 text-sm text-slate-400">Access the SmolVM Manager control plane.</p>

    <form method="POST" class="mt-6 flex flex-col gap-4">
      {#if form?.error}
        <div class="rounded-lg bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {form.error}
        </div>
      {/if}

      <div class="flex flex-col gap-1">
        <label for="username" class="text-sm font-medium text-slate-300">Username</label>
        <input
          id="username"
          name="username"
          type="text"
          required
          class="rounded-lg border border-white/10 bg-slate-950 px-4 py-2 text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
          placeholder="admin"
        />
      </div>

      <div class="flex flex-col gap-1">
        <label for="password" class="text-sm font-medium text-slate-300">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          class="rounded-lg border border-white/10 bg-slate-950 px-4 py-2 text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
          placeholder="••••••••"
        />
      </div>

      <input type="hidden" name="csrf" value={data.csrfToken ?? ''} />

      <button
        type="submit"
        class="mt-2 rounded-lg bg-cyan-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-400"
      >
        Sign In
      </button>
    </form>
  </div>
</main>
