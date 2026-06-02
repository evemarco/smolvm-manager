<script lang="ts">
  import type { VmStatus } from '$lib/types';

  let { status }: { status: string } = $props();

  const statusConfig: Record<VmStatus, { label: string; dotClass: string; bgClass: string }> = {
    running: {
      label: 'Running',
      dotClass: 'bg-emerald-400',
      bgClass: 'bg-emerald-500/10 text-emerald-300'
    },
    stopped: {
      label: 'Stopped',
      dotClass: 'bg-slate-500',
      bgClass: 'bg-slate-500/10 text-slate-400'
    },
    starting: {
      label: 'Starting',
      dotClass: 'bg-amber-400 animate-pulse',
      bgClass: 'bg-amber-500/10 text-amber-300'
    },
    stopping: {
      label: 'Stopping',
      dotClass: 'bg-amber-400 animate-pulse',
      bgClass: 'bg-amber-500/10 text-amber-300'
    },
    error: { label: 'Error', dotClass: 'bg-red-400', bgClass: 'bg-red-500/10 text-red-300' },
    unknown: {
      label: 'Unknown',
      dotClass: 'bg-slate-500',
      bgClass: 'bg-slate-500/10 text-slate-400'
    }
  };

  const normalized: VmStatus = $derived(
    (Object.keys(statusConfig) as VmStatus[]).includes(status as VmStatus)
      ? (status as VmStatus)
      : 'unknown'
  );

  const config = $derived(statusConfig[normalized]);
</script>

<span
  class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium {config.bgClass}"
>
  <span class="size-1.5 rounded-full {config.dotClass}"></span>
  {config.label}
</span>
