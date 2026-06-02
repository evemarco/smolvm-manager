<script lang="ts">
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { onMount } from 'svelte';

  onMount(() => {
    goto(resolve('/login'));
  });
</script>

<p class="p-8 text-center text-slate-400">Logging out...</p>
