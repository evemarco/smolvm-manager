<script lang="ts">
  import { onMount } from 'svelte';
  import {
    Plus,
    Search,
    RefreshCw,
    Loader2,
    AlertCircle,
    Monitor,
    Cpu,
    MemoryStick,
    HardDrive
  } from '@lucide/svelte';
  import { appName } from '$lib/site';
  import { toasts } from '$lib/toast';
  import type {
    SmolVmMachine,
    ImagePickerSelection,
    VmConfig,
    VmFormMode,
    CapacityData
  } from '$lib/types';
  import ViewToggle from '$lib/components/ViewToggle.svelte';
  import ConfirmationModal from '$lib/components/ConfirmationModal.svelte';
  import ToastContainer from '$lib/components/ToastContainer.svelte';
  import ImagePicker from '$lib/components/ImagePicker.svelte';
  import BrowseImagesButton from '$lib/components/BrowseImagesButton.svelte';
  import VmConfigForm from '$lib/components/VmConfigForm.svelte';
  import VmCard from './VmCard.svelte';
  import VmTable from './VmTable.svelte';
  import VmDetail from './VmDetail.svelte';

  let { data }: { data: { csrfToken: string | null } } = $props();

  let machines: SmolVmMachine[] = $state([]);
  let loading = $state(true);
  let error: string | null = $state(null);
  let searchQuery = $state('');
  let statusFilter = $state('all');
  let viewMode: 'cards' | 'table' = $state('cards');
  let selectedMachine: SmolVmMachine | null = $state(null);

  // Confirmation modal state
  let confirmOpen = $state(false);
  let confirmTitle = $state('');
  let confirmMessage = $state('');
  let confirmLabel = $state('Confirm');
  let confirmVariant: 'danger' | 'warning' = $state('danger');
  let confirmAction: (() => void) | null = $state(null);

  // Action loading states
  let actionLoading: Record<string, boolean> = $state({});
  let pickerOpen = $state(false);

  // Capacity summary
  let capacity: CapacityData | null = $state(null);

  // VM config form state
  let vmFormOpen = $state(false);
  let vmFormMode: VmFormMode = $state('create');
  let vmFormInitialConfig: VmConfig | undefined = $state(undefined);
  let vmFormExistingName: string | undefined = $state(undefined);

  let csrfToken = $derived(data.csrfToken ?? '');

  const statusOptions = [
    { value: 'all', label: 'All Statuses' },
    { value: 'running', label: 'Running' },
    { value: 'stopped', label: 'Stopped' },
    { value: 'error', label: 'Error' }
  ];

  let filteredMachines = $derived(() => {
    let result = machines;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter((m) => m.name.toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') {
      result = result.filter(
        (m) => (m.status ?? m.state ?? 'unknown').toLowerCase() === statusFilter
      );
    }
    return result;
  });

  async function fetchMachines() {
    loading = true;
    error = null;
    try {
      const response = await fetch('/api/smolvm/machines');
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? `Failed to load machines (${response.status})`);
      }
      const body = await response.json();
      machines = body.machines ?? [];
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load machines';
    } finally {
      loading = false;
    }
  }

  async function fetchCapacity() {
    try {
      const response = await fetch('/api/smolvm/capacity');
      if (response.ok) {
        capacity = await response.json();
      }
    } catch {
      // Capacity is supplementary; don't surface errors
    }
  }

  async function lifecycleAction(
    name: string,
    action: 'start' | 'stop' | 'restart',
    method: string = 'POST'
  ) {
    const key = `${action}-${name}`;
    actionLoading = { ...actionLoading, [key]: true };

    try {
      if (action === 'restart') {
        // Stop first, then start
        const stopResponse = await fetch(`/api/smolvm/machines/${encodeURIComponent(name)}/stop`, {
          method: 'POST',
          headers: { 'x-csrf-token': csrfToken }
        });
        if (!stopResponse.ok) {
          const body = await stopResponse.json().catch(() => null);
          throw new Error(body?.message ?? `Stop failed (${stopResponse.status})`);
        }

        const startResponse = await fetch(
          `/api/smolvm/machines/${encodeURIComponent(name)}/start`,
          {
            method: 'POST',
            headers: { 'x-csrf-token': csrfToken }
          }
        );
        if (!startResponse.ok) {
          const body = await startResponse.json().catch(() => null);
          throw new Error(body?.message ?? `Start failed (${startResponse.status})`);
        }
      } else {
        const response = await fetch(`/api/smolvm/machines/${encodeURIComponent(name)}/${action}`, {
          method,
          headers: { 'x-csrf-token': csrfToken }
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.message ?? `${action} failed (${response.status})`);
        }
      }

      toasts.push(`${name}: ${action} succeeded`, 'success');
      await fetchMachines();
    } catch (err) {
      toasts.push(err instanceof Error ? err.message : `${action} failed for ${name}`, 'error');
    } finally {
      actionLoading = { ...actionLoading, [key]: false };
    }
  }

  function confirmDelete(machine: SmolVmMachine) {
    confirmTitle = 'Delete Machine';
    confirmMessage = `Are you sure you want to delete "${machine.name}"? This action cannot be undone.`;
    confirmLabel = 'Delete';
    confirmVariant = 'danger';
    confirmAction = () => performDelete(machine.name);
    confirmOpen = true;
  }

  function confirmRestart(machine: SmolVmMachine) {
    confirmTitle = 'Restart Machine';
    confirmMessage = `Restart "${machine.name}"? This will stop and then start the machine.`;
    confirmLabel = 'Restart';
    confirmVariant = 'warning';
    confirmAction = () => {
      confirmOpen = false;
      lifecycleAction(machine.name, 'restart');
    };
    confirmOpen = true;
  }

  async function performDelete(name: string) {
    confirmOpen = false;
    const key = `delete-${name}`;
    actionLoading = { ...actionLoading, [key]: true };

    try {
      const response = await fetch(`/api/smolvm/machines/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken }
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.message ?? `Delete failed (${response.status})`);
      }
      toasts.push(`${name}: deleted`, 'success');
      selectedMachine = null;
      await fetchMachines();
    } catch (err) {
      toasts.push(err instanceof Error ? err.message : `Delete failed for ${name}`, 'error');
    } finally {
      actionLoading = { ...actionLoading, [key]: false };
    }
  }

  function openCreateVm() {
    vmFormMode = 'create';
    vmFormInitialConfig = undefined;
    vmFormExistingName = undefined;
    vmFormOpen = true;
  }

  function openEditVm(machine: SmolVmMachine) {
    vmFormMode = 'edit';
    vmFormExistingName = machine.name;
    // Convert machine response to config
    const config: VmConfig = { name: machine.name };
    if (typeof machine.cpus === 'number') config.cpus = machine.cpus;
    if (typeof machine.memoryMb === 'number') config.memory = machine.memoryMb;
    if (typeof machine.memory === 'number') config.memory = machine.memory;
    if (typeof machine.storage === 'number') config.storage = machine.storage;
    if (typeof machine.overlay === 'number') config.overlay = machine.overlay;
    if (typeof machine.network === 'boolean') config.net = machine.network;
    if (typeof machine.gpu === 'boolean') config.gpu = machine.gpu;
    if (typeof machine.workdir === 'string') config.workdir = machine.workdir;
    if (typeof machine.entrypoint === 'string') config.entrypoint = machine.entrypoint;
    if (typeof machine.cmd === 'string') config.cmd = machine.cmd;
    if (typeof machine.sshAgent === 'boolean') config.sshAgent = machine.sshAgent;
    if (typeof machine.image === 'string') {
      const colonIdx = machine.image.lastIndexOf(':');
      if (colonIdx > 0) {
        config.image = machine.image.slice(0, colonIdx);
        config.tag = machine.image.slice(colonIdx + 1);
      } else {
        config.image = machine.image;
      }
    }
    if (Array.isArray(machine.ports)) {
      config.ports = machine.ports.map((p: Record<string, unknown>) => ({
        host: Number(p.host),
        guest: Number(p.guest)
      }));
    }
    if (Array.isArray(machine.mounts)) {
      config.volumes = machine.mounts.map((m: Record<string, unknown>) => ({
        host: String(m.source ?? m.host),
        guest: String(m.target ?? m.guest),
        ...(m.readonly ? { readOnly: true } : m.readOnly ? { readOnly: true } : {})
      }));
    }
    if (typeof machine.env === 'object' && machine.env !== null && !Array.isArray(machine.env)) {
      config.env = machine.env as Record<string, string>;
    }
    if (Array.isArray(machine.init)) {
      config.init = machine.init.map(String);
    }
    vmFormInitialConfig = config;
    vmFormOpen = true;
  }

  function openCopyVm(machine: SmolVmMachine) {
    vmFormMode = 'copy';
    vmFormExistingName = machine.name;
    const config: VmConfig = { name: `${machine.name}-copy` };
    if (typeof machine.cpus === 'number') config.cpus = machine.cpus;
    if (typeof machine.memoryMb === 'number') config.memory = machine.memoryMb;
    if (typeof machine.memory === 'number') config.memory = machine.memory;
    if (typeof machine.storage === 'number') config.storage = machine.storage;
    if (typeof machine.overlay === 'number') config.overlay = machine.overlay;
    if (typeof machine.network === 'boolean') config.net = machine.network;
    if (typeof machine.gpu === 'boolean') config.gpu = machine.gpu;
    if (typeof machine.image === 'string') {
      const colonIdx = machine.image.lastIndexOf(':');
      if (colonIdx > 0) {
        config.image = machine.image.slice(0, colonIdx);
        config.tag = machine.image.slice(colonIdx + 1);
      } else {
        config.image = machine.image;
      }
    }
    if (Array.isArray(machine.ports)) {
      config.ports = machine.ports.map((p: Record<string, unknown>) => ({
        host: Number(p.host),
        guest: Number(p.guest)
      }));
    }
    if (Array.isArray(machine.mounts)) {
      config.volumes = machine.mounts.map((m: Record<string, unknown>) => ({
        host: String(m.source ?? m.host),
        guest: String(m.target ?? m.guest),
        ...(m.readonly ? { readOnly: true } : m.readOnly ? { readOnly: true } : {})
      }));
    }
    if (typeof machine.env === 'object' && machine.env !== null && !Array.isArray(machine.env)) {
      config.env = { ...(machine.env as Record<string, string>) };
    }
    vmFormInitialConfig = config;
    vmFormOpen = true;
  }

  async function handleVmFormSave(config: VmConfig) {
    try {
      if (vmFormMode === 'create' || vmFormMode === 'copy') {
        const response = await fetch('/api/smolvm/machines/create', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          body: JSON.stringify(config)
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.message ?? body?.error ?? `Create failed (${response.status})`);
        }
        toasts.push(`VM "${config.name}" created`, 'success');
      } else if (vmFormMode === 'edit') {
        const name = vmFormExistingName ?? config.name;
        const response = await fetch(`/api/smolvm/machines/${encodeURIComponent(name)}/update`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          body: JSON.stringify(config)
        });
        if (response.status === 409) {
          // Recreate required - handled by the form's confirmation modal
          const body = await response.json();
          throw new Error(body.message ?? 'Recreate required');
        }
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.message ?? body?.error ?? `Update failed (${response.status})`);
        }
        toasts.push(`VM "${name}" updated`, 'success');
      } else if (vmFormMode === 'recreate') {
        const name = vmFormExistingName ?? config.name;
        const response = await fetch(`/api/smolvm/machines/${encodeURIComponent(name)}/recreate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          body: JSON.stringify(config)
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.message ?? body?.error ?? `Recreate failed (${response.status})`);
        }
        toasts.push(`VM "${name}" recreated`, 'success');
      }
      vmFormOpen = false;
      await fetchMachines();
    } catch (err) {
      toasts.push(err instanceof Error ? err.message : 'Operation failed', 'error');
    }
  }

  onMount(() => {
    fetchMachines();
    fetchCapacity();
  });
</script>

<svelte:head>
  <title>{appName}</title>
</svelte:head>

<ToastContainer />

<ConfirmationModal
  bind:open={confirmOpen}
  title={confirmTitle}
  message={confirmMessage}
  {confirmLabel}
  {confirmVariant}
  onConfirm={() => confirmAction?.()}
  onCancel={() => (confirmOpen = false)}
/>

{#if pickerOpen}
  <ImagePicker
    onSelect={(selection: ImagePickerSelection) => {
      toasts.push(`Selected image: ${selection.fullName}`, 'success');
      pickerOpen = false;
    }}
    onClose={() => (pickerOpen = false)}
  />
{/if}

{#if vmFormOpen}
  <div
    role="dialog"
    aria-modal="true"
    tabindex="-1"
    class="fixed inset-0 z-40 overflow-y-auto bg-black/60 backdrop-blur-sm"
    onclick={(e) => {
      if (e.target === e.currentTarget) vmFormOpen = false;
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') vmFormOpen = false;
    }}
  >
    <div class="mx-auto max-w-3xl p-4 py-8">
      <div class="rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
        <VmConfigForm
          mode={vmFormMode}
          initialConfig={vmFormInitialConfig}
          existingMachineName={vmFormExistingName}
          {csrfToken}
          onSave={handleVmFormSave}
          onCancel={() => (vmFormOpen = false)}
        />
      </div>
    </div>
  </div>
{/if}

<div
  class="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-10"
>
  <!-- Header -->
  <header class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <p class="text-sm uppercase tracking-[0.3em] text-cyan-300/80">Dashboard</p>
      <h1 class="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
        Virtual Machines
      </h1>
    </div>
    <div class="flex items-center gap-3">
      <button
        class="flex items-center gap-2 rounded-lg border border-white/10 bg-slate-800/80 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
        onclick={fetchMachines}
        disabled={loading}
      >
        <RefreshCw size={16} class={loading ? 'animate-spin' : ''} />
        Refresh
      </button>
      <BrowseImagesButton onClick={() => (pickerOpen = true)} />
      <button
        class="flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed"
        onclick={openCreateVm}
        aria-label="Create new virtual machine"
      >
        <Plus size={16} />
        Create VM
      </button>
    </div>
  </header>

  <!-- Capacity summary -->
  {#if capacity}
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3 sm:gap-4">
      <div
        class="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2.5"
      >
        <Cpu size={16} class="text-cyan-400" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs text-slate-500">CPU</p>
          <p class="text-sm font-medium text-white">
            {capacity.usedCpus.toFixed(1)}
            <span class="text-slate-400">/ {capacity.allocatedCpus}</span>
          </p>
        </div>
      </div>
      <div
        class="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2.5"
      >
        <MemoryStick size={16} class="text-violet-400" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs text-slate-500">Memory</p>
          <p class="text-sm font-medium text-white">
            {capacity.usedMemoryMb >= 1024
              ? `${(capacity.usedMemoryMb / 1024).toFixed(1)} GB`
              : `${capacity.usedMemoryMb} MB`}
            <span class="text-slate-400"
              >/ {capacity.allocatedMemoryMb >= 1024
                ? `${(capacity.allocatedMemoryMb / 1024).toFixed(1)} GB`
                : `${capacity.allocatedMemoryMb} MB`}</span
            >
          </p>
        </div>
      </div>
      <div
        class="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-3 py-2.5"
      >
        <HardDrive size={16} class="text-emerald-400" />
        <div class="min-w-0 flex-1">
          <p class="truncate text-xs text-slate-500">Disk</p>
          <p class="text-sm font-medium text-white">{capacity.usedDiskGb.toFixed(1)} GB</p>
        </div>
      </div>
    </div>
  {/if}

  <!-- Search & Filters -->
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div class="flex flex-1 items-center gap-3">
      <div class="relative flex-1 sm:max-w-xs">
        <Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          type="text"
          placeholder="Search machines..."
          bind:value={searchQuery}
          class="w-full rounded-lg border border-white/10 bg-slate-950 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
        />
      </div>
      <select
        bind:value={statusFilter}
        class="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-300 focus:border-cyan-400 focus:outline-none"
      >
        {#each statusOptions as opt (opt.value)}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
    </div>
    <ViewToggle value={viewMode} onChange={(m) => (viewMode = m)} />
  </div>

  <!-- Content -->
  {#if loading && machines.length === 0}
    <div class="flex flex-col items-center justify-center gap-3 py-20">
      <Loader2 size={32} class="animate-spin text-cyan-400" />
      <p class="text-sm text-slate-400">Loading machines...</p>
    </div>
  {:else if error}
    <div
      class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 py-16"
    >
      <AlertCircle size={32} class="text-red-400" />
      <p class="text-sm text-red-300">{error}</p>
      <button
        class="mt-2 rounded-lg bg-slate-800 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
        onclick={fetchMachines}
      >
        Retry
      </button>
    </div>
  {:else if filteredMachines().length === 0 && machines.length === 0}
    <!-- Empty state -->
    <div
      class="flex flex-col items-center justify-center gap-4 rounded-2xl border border-white/10 bg-white/5 py-20"
    >
      <div class="flex size-16 items-center justify-center rounded-2xl bg-slate-800">
        <Monitor size={28} class="text-slate-500" />
      </div>
      <div class="text-center">
        <h2 class="text-lg font-medium text-white">No virtual machines</h2>
        <p class="mt-1 text-sm text-slate-400">
          Get started by creating your first SmolVM machine.
        </p>
      </div>
      <div class="mt-2 flex items-center gap-2">
        <BrowseImagesButton onClick={() => (pickerOpen = true)} />
        <button
          class="flex items-center gap-2 rounded-lg bg-cyan-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-cyan-400"
          onclick={openCreateVm}
        >
          <Plus size={16} />
          Create VM
        </button>
      </div>
    </div>
  {:else if filteredMachines().length === 0}
    <div class="flex flex-col items-center justify-center gap-3 py-16">
      <Search size={28} class="text-slate-500" />
      <p class="text-sm text-slate-400">No machines match your search.</p>
    </div>
  {:else if selectedMachine}
    <VmDetail
      machine={selectedMachine}
      onBack={() => (selectedMachine = null)}
      onStart={(m) => lifecycleAction(m.name, 'start')}
      onStop={(m) => lifecycleAction(m.name, 'stop')}
      onRestart={(m) => confirmRestart(m)}
      onDelete={(m) => confirmDelete(m)}
      onEdit={(m) => openEditVm(m)}
      onCopy={(m) => openCopyVm(m)}
      {actionLoading}
    />
  {:else if viewMode === 'cards'}
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each filteredMachines() as machine (machine.name)}
        <VmCard
          {machine}
          onSelect={(m) => (selectedMachine = m)}
          onStart={(m) => lifecycleAction(m.name, 'start')}
          onStop={(m) => lifecycleAction(m.name, 'stop')}
          onRestart={(m) => confirmRestart(m)}
          onDelete={(m) => confirmDelete(m)}
          onEdit={(m) => openEditVm(m)}
          onCopy={(m) => openCopyVm(m)}
          {actionLoading}
        />
      {/each}
    </div>
  {:else}
    <VmTable
      machines={filteredMachines()}
      onSelect={(m) => (selectedMachine = m)}
      onStart={(m) => lifecycleAction(m.name, 'start')}
      onStop={(m) => lifecycleAction(m.name, 'stop')}
      onRestart={(m) => confirmRestart(m)}
      onDelete={(m) => confirmDelete(m)}
      onEdit={(m) => openEditVm(m)}
      onCopy={(m) => openCopyVm(m)}
      {actionLoading}
    />
  {/if}
</div>
