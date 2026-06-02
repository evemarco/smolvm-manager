<script lang="ts">
  import { X } from '@lucide/svelte';
  import type { ToastVariant } from '$lib/types';

  let {
    message,
    variant = 'info',
    onDismiss
  }: {
    message: string;
    variant?: ToastVariant;
    onDismiss: () => void;
  } = $props();

  const variantStyles: Record<ToastVariant, string> = {
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    error: 'border-red-500/30 bg-red-500/10 text-red-200',
    info: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
  };
</script>

<div class="flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg {variantStyles[variant]}">
  <p class="flex-1 text-sm">{message}</p>
  <button
    class="shrink-0 rounded-md p-1 transition hover:bg-white/10"
    onclick={onDismiss}
    aria-label="Dismiss notification"
  >
    <X size={16} />
  </button>
</div>
