<script lang="ts">
  import { LayoutGrid, List } from '@lucide/svelte';
  import type { ViewMode } from '$lib/types';

  let { value = 'cards', onChange }: { value?: ViewMode; onChange: (mode: ViewMode) => void } =
    $props();
</script>

<div class="flex rounded-lg border border-white/10 bg-slate-900/60 p-0.5">
  <button
    class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition {value ===
    'cards'
      ? 'bg-cyan-500/20 text-cyan-300'
      : 'text-slate-400 hover:text-white'}"
    onclick={() => onChange('cards')}
    aria-label="Card view"
  >
    <LayoutGrid size={14} />
    Cards
  </button>
  <button
    class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition {value ===
    'table'
      ? 'bg-cyan-500/20 text-cyan-300'
      : 'text-slate-400 hover:text-white'}"
    onclick={() => onChange('table')}
    aria-label="Table view"
  >
    <List size={14} />
    Table
  </button>
</div>
