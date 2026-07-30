<script lang="ts">
  import { X } from '@lucide/svelte';
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    title,
    subtitle,
    variant = 'default',
    confirmLabel = 'Confirm',
    confirmDisabled = false,
    loading = false,
    error,
    onConfirm,
    onCancel,
    children
  }: {
    open?: boolean;
    title: string;
    subtitle?: string;
    variant?: 'default' | 'danger';
    confirmLabel?: string;
    confirmDisabled?: boolean;
    loading?: boolean;
    error?: string | null;
    onConfirm: () => void;
    onCancel: () => void;
    children?: Snippet;
  } = $props();

  const confirmClasses = $derived(
    variant === 'danger'
      ? 'rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed'
      : 'rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed'
  );
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    onclick={(e) => {
      if (e.target === e.currentTarget) onCancel();
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') onCancel();
    }}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0 flex-1">
          <h3 class="text-lg font-semibold text-white">{title}</h3>
          {#if subtitle}
            <p class="mt-1 text-sm text-slate-400">{subtitle}</p>
          {/if}
        </div>
        <button
          class="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
          onclick={onCancel}
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>
      </div>

      <div class="mt-4">
        {#if children}
          {@render children()}
        {/if}
      </div>

      {#if error}
        <div
          class="mt-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-300"
          role="alert"
        >
          {error}
        </div>
      {/if}

      <div class="mt-6 flex justify-end gap-3">
        <button
          class="rounded-lg border border-white/10 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
          onclick={onCancel}
          disabled={loading}
        >
          Cancel
        </button>
        <button class={confirmClasses} onclick={onConfirm} disabled={confirmDisabled || loading}>
          {#if loading}
            <span class="flex items-center gap-2">
              <svg class="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-opacity="0.25"
                  stroke-width="4"
                ></circle>
                <path
                  d="M22 12a10 10 0 0 1-10 10"
                  stroke="currentColor"
                  stroke-width="4"
                  stroke-linecap="round"
                ></path>
              </svg>
              Working…
            </span>
          {:else}
            {confirmLabel}
          {/if}
        </button>
      </div>
    </div>
  </div>
{/if}
