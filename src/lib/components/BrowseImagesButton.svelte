<script lang="ts">
  import { Search } from '@lucide/svelte';

  let {
    onClick
  }: {
    onClick: () => void;
  } = $props();
</script>

<button
  type="button"
  class="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-800/80 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
  on:click={onClick}
>
  <Search size={16} />
  Browse Images
</button>
