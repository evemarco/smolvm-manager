<script lang="ts">
  import { AlertTriangle } from '@lucide/svelte';
  import type { ConfirmVariant } from '$lib/types';

  let {
    open = $bindable(false),
    title = 'Confirm Action',
    message = '',
    confirmLabel = 'Confirm',
    confirmVariant = 'danger',
    onConfirm,
    onCancel
  }: {
    open?: boolean;
    title?: string;
    message?: string;
    confirmLabel?: string;
    confirmVariant?: ConfirmVariant;
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();

  const confirmStyles: Record<ConfirmVariant, string> = {
    danger: 'bg-red-600 hover:bg-red-500 focus-visible:ring-red-500',
    warning: 'bg-amber-600 hover:bg-amber-500 focus-visible:ring-amber-500'
  };
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    onclick={onCancel}
    onkeydown={(e) => e.key === 'Escape' && onCancel()}
  >
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="flex items-start gap-4">
        <div
          class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-500/10"
        >
          <AlertTriangle size={20} class="text-red-400" />
        </div>
        <div class="flex-1">
          <h2 class="text-lg font-semibold text-white">{title}</h2>
          <p class="mt-2 text-sm leading-relaxed text-slate-300">{message}</p>
        </div>
      </div>

      <div class="mt-6 flex justify-end gap-3">
        <button
          class="rounded-lg border border-white/10 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
          onclick={onCancel}
        >
          Cancel
        </button>
        <button
          class="rounded-lg px-4 py-2 text-sm font-medium text-white transition focus-visible:outline-none focus-visible:ring-2 {confirmStyles[
            confirmVariant
          ]}"
          onclick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}
