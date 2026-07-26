<script lang="ts">
  import { Terminal } from '@lucide/svelte';

  let {
    onClick
  }: {
    onClick: () => void;
  } = $props();
</script>

<button
  type="button"
  data-testid="global-logs-toggle"
  class="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-800/80 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
  onclick={onClick}
>
  <Terminal size={16} />
  Global Logs
</button>
