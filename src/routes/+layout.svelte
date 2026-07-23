<script lang="ts">
  import { Menu, X, Settings, LayoutDashboard } from '@lucide/svelte';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import favicon from '$lib/assets/favicon.svg';
  import '../app.css';

  let { children, data } = $props();
  let mobileMenuOpen = $state(false);

  function closeMobileMenu() {
    mobileMenuOpen = false;
  }
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <meta name="theme-color" content="#020617" />
</svelte:head>

<a href="#main-content" class="skip-to-content">Skip to content</a>

{#if data.admin}
  <header class="border-b border-white/10 bg-slate-900/80 backdrop-blur">
    <div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
      <div class="flex items-center gap-3">
        <a
          href={resolve('/')}
          class="flex items-center gap-2 rounded-md px-1 py-0.5 transition hover:bg-white/10"
          aria-label="Go to dashboard"
        >
          <img
            src={favicon}
            alt=""
            width={24}
            height={24}
            class="hidden sm:inline-block"
            aria-hidden="true"
          />
          <span class="text-sm font-medium text-white">SmolVM Manager</span>
        </a>
      </div>

      <!-- Desktop nav -->
      <div class="hidden items-center gap-4 sm:flex">
        <span class="text-sm text-slate-400">{data.admin.email}</span>
        {#if page.url.pathname !== '/'}
          <a
            href={resolve('/')}
            class="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
          >
            <LayoutDashboard size={14} />
            Dashboard
          </a>
        {/if}
        <!-- eslint-disable svelte/no-navigation-without-resolve -->
        <a
          href="/settings"
          class="inline-flex items-center gap-1.5 rounded-md bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
        >
          <Settings size={14} />
          Settings
        </a>
        <!-- eslint-enable svelte/no-navigation-without-resolve -->
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

      <!-- Mobile menu toggle -->
      <button
        class="rounded-md p-2 text-slate-300 transition hover:bg-white/10 hover:text-white sm:hidden"
        onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
        aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={mobileMenuOpen}
      >
        {#if mobileMenuOpen}
          <X size={20} />
        {:else}
          <Menu size={20} />
        {/if}
      </button>
    </div>

    <!-- Mobile nav dropdown -->
    {#if mobileMenuOpen}
      <div class="border-t border-white/10 px-4 py-3 sm:hidden">
        <div class="flex flex-col gap-3">
          <span class="text-sm text-slate-400">{data.admin.email}</span>
          {#if page.url.pathname !== '/'}
            <a
              href={resolve('/')}
              class="inline-flex items-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
              onclick={closeMobileMenu}
            >
              <LayoutDashboard size={16} />
              Dashboard
            </a>
          {/if}
          <!-- eslint-disable svelte/no-navigation-without-resolve -->
          <a
            href="/settings"
            class="inline-flex items-center gap-2 rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
            onclick={closeMobileMenu}
          >
            <Settings size={16} />
            Settings
          </a>
          <!-- eslint-enable svelte/no-navigation-without-resolve -->
          <form method="POST" action="/logout" class="inline" onsubmit={closeMobileMenu}>
            <input type="hidden" name="csrf" value={data.csrfToken ?? ''} />
            <button
              type="submit"
              class="w-full rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
            >
              Logout
            </button>
          </form>
        </div>
      </div>
    {/if}
  </header>
{/if}

<main id="main-content">{@render children()}</main>
