<script lang="ts">
  import { appName, appSubtitle } from '$lib/site';

  const highlights = ['LAN/Tailscale access', 'Single-admin workflow', 'PWA-ready shell'];

  const cards = [
    {
      title: 'Foundation first',
      body: 'The scaffold keeps the app minimal, typed, and ready for the backend and UI layers that come next.'
    },
    {
      title: 'Safe by default',
      body: 'The manager stays local-first and keeps SmolVM integration behind authenticated manager endpoints.'
    },
    {
      title: 'Tooling wired',
      body: 'Tailwind, linting, formatting, PWA support, Playwright, and Bun tests are ready from day one.'
    }
  ];
</script>

<svelte:head>
  <title>{appName}</title>
  <meta
    name="description"
    content="SmolVM Manager is the authenticated LAN control plane for local SmolVM operations."
  />
</svelte:head>

<main class="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-10 lg:px-10">
  <section
    class="rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-slate-950/40 backdrop-blur"
  >
    <p class="text-sm uppercase tracking-[0.3em] text-cyan-300/80">SmolVM Manager</p>
    <h1 class="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">{appName}</h1>
    <p class="mt-4 max-w-2xl text-base leading-7 text-slate-300">{appSubtitle}</p>

    <div class="mt-8 flex flex-wrap gap-3">
      {#each highlights as highlight (highlight)}
        <span
          class="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm text-cyan-100"
        >
          {highlight}
        </span>
      {/each}
    </div>
  </section>

  <section class="grid gap-4 md:grid-cols-3">
    {#each cards as card (card.title)}
      <article class="rounded-2xl border border-white/10 bg-slate-900/60 p-6">
        <h2 class="text-lg font-medium text-white">{card.title}</h2>
        <p class="mt-3 text-sm leading-6 text-slate-300">{card.body}</p>
      </article>
    {/each}
  </section>
</main>
