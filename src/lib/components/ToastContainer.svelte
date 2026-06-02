<script lang="ts">
  import { toasts } from '$lib/toast';
  import Toast from '$lib/components/Toast.svelte';
</script>

{#if $toasts.length > 0}
  <div class="fixed bottom-6 right-6 z-50 flex flex-col gap-2">
    {#each $toasts as toast (toast.id)}
      <Toast
        message={toast.message}
        variant={toast.variant}
        onDismiss={() => toasts.dismiss(toast.id)}
      />
    {/each}
  </div>
{/if}
