<script lang="ts">
  import { Search } from '@lucide/svelte';
  import ImagePicker from './ImagePicker.svelte';
  import type { ImagePickerSelection } from '$lib/types';

  let {
    onSelect,
    label = 'Browse Images'
  }: {
    onSelect: (selection: ImagePickerSelection) => void;
    label?: string;
  } = $props();

  let open = $state(false);
</script>

<button
  type="button"
  class="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-800/80 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
  onclick={() => (open = true)}
>
  <Search size={16} />
  {label}
</button>

{#if open}
  <ImagePicker {onSelect} onClose={() => (open = false)} />
{/if}
