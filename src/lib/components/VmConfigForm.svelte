<script lang="ts">
  import {
    Plus,
    Trash2,
    ChevronDown,
    ChevronRight,
    FileCode2,
    Copy,
    AlertTriangle,
    Loader2,
    Search,
    X
  } from '@lucide/svelte';
  import { toasts } from '$lib/toast';
  import ConfirmationModal from '$lib/components/ConfirmationModal.svelte';
  import ImagePicker from '$lib/components/ImagePicker.svelte';
  import { detectSensitiveHostMounts } from '$lib/sensitive-mounts';
  import type {
    VmConfig,
    VmVolumeMount,
    VmFormMode,
    ConfigDiff,
    ImagePickerSelection
  } from '$lib/types';

  let {
    mode = 'create',
    initialConfig,
    existingMachineName,
    csrfToken,
    onSave,
    onCancel
  }: {
    mode?: VmFormMode;
    initialConfig?: VmConfig;
    existingMachineName?: string;
    csrfToken: string;
    onSave?: (config: VmConfig) => void;
    onCancel?: () => void;
  } = $props();

  const RECREATE_FIELDS = new Set(['image', 'tag', 'from', 'entrypoint', 'cmd']);

  // Form state — intentional: capture initialConfig once at mount, not reactively
  // svelte-ignore state_referenced_locally
  let config = $state<VmConfig>(initialConfig ? { ...initialConfig } : defaultConfig());
  let saving = $state(false);
  let showTomlImport = $state(false);
  let tomlInput = $state('');
  let tomlErrors: Array<{ field: string; message: string }> = $state([]);
  let pickerOpen = $state(false);
  let expandedSections = $state<Record<string, boolean>>({
    basics: true,
    resources: true,
    network: false,
    volumes: false,
    environment: false,
    commands: false,
    advanced: false
  });

  // Confirmation modal for recreate
  let recreateConfirmOpen = $state(false);
  let recreateDiffs: ConfigDiff[] = $state([]);

  // Repeated field helpers
  let newPortHost = $state('');
  let newPortGuest = $state('');
  let newVolumeHost = $state('');
  let newVolumeGuest = $state('');
  let newVolumeReadOnly = $state(false);
  let newEnvKey = $state('');
  let newEnvValue = $state('');
  let newAllowHost = $state('');
  let newAllowCidr = $state('');
  let newInitCommand = $state('');

  let sensitiveMountWarnings = $derived(
    config.volumes && config.volumes.length > 0 ? detectSensitiveHostMounts(config.volumes) : []
  );

  function defaultConfig(): VmConfig {
    return {
      name: '',
      cpus: 4,
      memory: 8192,
      net: true
    };
  }

  function toggleSection(section: string) {
    expandedSections = { ...expandedSections, [section]: !expandedSections[section] };
  }

  // Port management
  function addPort() {
    const host = parseInt(newPortHost, 10);
    const guest = parseInt(newPortGuest, 10);
    if (host > 0 && host <= 65535 && guest > 0 && guest <= 65535) {
      config.ports = [...(config.ports ?? []), { host, guest }];
      newPortHost = '';
      newPortGuest = '';
    }
  }

  function removePort(index: number) {
    config.ports = config.ports?.filter((_, i) => i !== index);
  }

  // Volume management
  function addVolume() {
    if (newVolumeHost && newVolumeGuest) {
      const vol: VmVolumeMount = { host: newVolumeHost, guest: newVolumeGuest };
      if (newVolumeReadOnly) vol.readOnly = true;
      config.volumes = [...(config.volumes ?? []), vol];
      newVolumeHost = '';
      newVolumeGuest = '';
      newVolumeReadOnly = false;
    }
  }

  function removeVolume(index: number) {
    config.volumes = config.volumes?.filter((_, i) => i !== index);
  }

  // Env management
  function addEnv() {
    if (newEnvKey && newEnvValue) {
      config.env = { ...(config.env ?? {}), [newEnvKey]: newEnvValue };
      newEnvKey = '';
      newEnvValue = '';
    }
  }

  function removeEnv(key: string) {
    const env = { ...(config.env ?? {}) };
    delete env[key];
    config.env = env;
  }

  // Allow hosts management
  function addAllowHost() {
    if (newAllowHost) {
      config.allowHosts = [...(config.allowHosts ?? []), newAllowHost];
      newAllowHost = '';
    }
  }

  function removeAllowHost(index: number) {
    config.allowHosts = config.allowHosts?.filter((_, i) => i !== index);
  }

  // Allow CIDRs management
  function addAllowCidr() {
    if (newAllowCidr) {
      config.allowCidrs = [...(config.allowCidrs ?? []), newAllowCidr];
      newAllowCidr = '';
    }
  }

  function removeAllowCidr(index: number) {
    config.allowCidrs = config.allowCidrs?.filter((_, i) => i !== index);
  }

  // Init commands management
  function addInitCommand() {
    if (newInitCommand) {
      config.init = [...(config.init ?? []), newInitCommand];
      newInitCommand = '';
    }
  }

  function removeInitCommand(index: number) {
    config.init = config.init?.filter((_, i) => i !== index);
  }

  // Image picker callback
  function handleImageSelect(selection: ImagePickerSelection) {
    config.image = `${selection.namespace}/${selection.repository}`;
    config.tag = selection.tag;
    pickerOpen = false;
  }

  // TOML preview
  async function generateToml() {
    try {
      const response = await fetch('/api/smolvm/toml-generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify(config)
      });
      const data = await response.json();
      if (data.toml) {
        return data.toml;
      }
      return '# Error generating TOML';
    } catch {
      return '# Error generating TOML';
    }
  }

  // TOML import
  async function importToml() {
    tomlErrors = [];
    try {
      const response = await fetch('/api/smolvm/toml-validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': csrfToken
        },
        body: JSON.stringify({ toml: tomlInput })
      });
      const data = await response.json();
      if (data.parseErrors && data.parseErrors.length > 0) {
        tomlErrors = data.parseErrors;
        return;
      }
      if (data.validation && !data.validation.valid) {
        tomlErrors = data.validation.errors ?? [];
        return;
      }
      // Merge parsed config into form
      if (data.config) {
        config = { ...defaultConfig(), ...data.config };
      }
      showTomlImport = false;
      tomlInput = '';
      toasts.push('TOML imported successfully', 'success');
    } catch {
      toasts.push('Failed to import TOML', 'error');
    }
  }

  // Save handler
  async function handleSave() {
    if (!config.name.trim()) {
      toasts.push('Machine name is required', 'error');
      return;
    }

    // For edit mode, check if recreate-required fields changed
    if (mode === 'edit' && initialConfig) {
      const diffs: ConfigDiff[] = [];
      const allKeys = new Set<string>([...Object.keys(initialConfig), ...Object.keys(config)]);
      for (const key of allKeys) {
        const oldVal = (initialConfig as Record<string, unknown>)[key];
        const newVal = (config as Record<string, unknown>)[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          diffs.push({
            field: key,
            oldValue: oldVal,
            newValue: newVal,
            requiresRecreate: RECREATE_FIELDS.has(key)
          });
        }
      }

      const recreateDiffsFound = diffs.filter((d) => d.requiresRecreate);
      if (recreateDiffsFound.length > 0) {
        recreateDiffs = recreateDiffsFound;
        recreateConfirmOpen = true;
        return;
      }
    }

    saving = true;
    try {
      onSave?.(config);
    } finally {
      saving = false;
    }
  }

  function confirmRecreate() {
    recreateConfirmOpen = false;
    saving = true;
    try {
      onSave?.(config);
    } finally {
      saving = false;
    }
  }

  // Download TOML
  async function downloadToml() {
    const toml = await generateToml();
    const blob = new Blob([toml], { type: 'text/toml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${config.name || 'vm-config'}.toml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Copy TOML to clipboard
  async function copyTomlToClipboard() {
    const toml = await generateToml();
    await navigator.clipboard.writeText(toml);
    toasts.push('TOML copied to clipboard', 'success');
  }

  // Client-side TOML generation for preview (mirrors server-side logic)
  function configToTomlLocal(): string {
    const lines: string[] = [];
    if (config.image || config.tag) {
      lines.push('[image]');
      if (config.image) lines.push(`name = "${config.image}"`);
      if (config.tag) lines.push(`tag = "${config.tag}"`);
      lines.push('');
    }
    if (config.from) {
      lines.push(`from = "${config.from}"`);
      lines.push('');
    }
    if (config.cpus || config.memory || config.storage || config.overlay) {
      lines.push('[resources]');
      if (config.cpus) lines.push(`cpus = ${config.cpus}`);
      if (config.memory) lines.push(`memory = ${config.memory}`);
      if (config.storage) lines.push(`storage = ${config.storage}`);
      if (config.overlay) lines.push(`overlay = ${config.overlay}`);
      lines.push('');
    }
    if (config.gpu || config.gpuVram) {
      lines.push('[gpu]');
      lines.push(`enabled = ${config.gpu ? 'true' : 'false'}`);
      if (config.gpuVram) lines.push(`vram = ${config.gpuVram}`);
      lines.push('');
    }
    if (
      config.net ||
      (config.ports && config.ports.length > 0) ||
      (config.allowHosts && config.allowHosts.length > 0) ||
      (config.allowCidrs && config.allowCidrs.length > 0)
    ) {
      lines.push('[network]');
      if (config.net !== undefined) lines.push(`net = ${config.net ? 'true' : 'false'}`);
      if (config.ports && config.ports.length > 0)
        lines.push(`ports = [${config.ports.map((p) => `"${p.host}:${p.guest}"`).join(', ')}]`);
      if (config.allowHosts && config.allowHosts.length > 0)
        lines.push(`allow_hosts = [${config.allowHosts.map((h) => `"${h}"`).join(', ')}]`);
      if (config.allowCidrs && config.allowCidrs.length > 0)
        lines.push(`allow_cidrs = [${config.allowCidrs.map((c) => `"${c}"`).join(', ')}]`);
      lines.push('');
    }
    if (config.volumes && config.volumes.length > 0) {
      lines.push('[volumes]');
      for (const vol of config.volumes) {
        lines.push(`"${vol.host}" = "${vol.guest}${vol.readOnly ? ':ro' : ''}"`);
      }
      lines.push('');
    }
    if (config.env && Object.keys(config.env).length > 0) {
      lines.push('[env]');
      for (const [key, value] of Object.entries(config.env)) {
        lines.push(`${key} = "${value}"`);
      }
      lines.push('');
    }
    if (
      config.workdir ||
      (config.init && config.init.length > 0) ||
      config.sshAgent !== undefined ||
      config.entrypoint ||
      config.cmd
    ) {
      lines.push('[commands]');
      if (config.workdir) lines.push(`workdir = "${config.workdir}"`);
      if (config.init && config.init.length > 0)
        lines.push(`init = [${config.init.map((i) => `"${i}"`).join(', ')}]`);
      if (config.sshAgent !== undefined)
        lines.push(`ssh_agent = ${config.sshAgent ? 'true' : 'false'}`);
      if (config.entrypoint) lines.push(`entrypoint = "${config.entrypoint}"`);
      if (config.cmd) lines.push(`cmd = "${config.cmd}"`);
      lines.push('');
    }
    return lines.join('\n').trimEnd() || '# Empty configuration';
  }
</script>

{#if pickerOpen}
  <ImagePicker onSelect={handleImageSelect} onClose={() => (pickerOpen = false)} />
{/if}

<ConfirmationModal
  bind:open={recreateConfirmOpen}
  title="Recreate Required"
  message="The following changes require VM recreation (the VM will be deleted and recreated with the new config): {recreateDiffs
    .map((d) => d.field)
    .join(', ')}. This is a destructive operation. Proceed?"
  confirmLabel="Recreate VM"
  confirmVariant="danger"
  onConfirm={confirmRecreate}
  onCancel={() => (recreateConfirmOpen = false)}
/>

<div class="flex flex-col gap-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div>
      <h2 class="text-xl font-semibold text-white">
        {mode === 'create'
          ? 'Create Virtual Machine'
          : mode === 'copy'
            ? 'Copy Virtual Machine'
            : mode === 'recreate'
              ? 'Recreate Virtual Machine'
              : 'Edit Configuration'}
      </h2>
      <p class="mt-1 text-sm text-slate-400">
        {mode === 'create'
          ? 'Configure a new SmolVM machine.'
          : mode === 'copy'
            ? `Copying configuration from "${existingMachineName ?? ''}".`
            : mode === 'recreate'
              ? 'This will delete and recreate the VM.'
              : `Editing "${existingMachineName ?? config.name}".`}
      </p>
    </div>
    <div class="flex items-center gap-2">
      <button
        class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
        onclick={() => (showTomlImport = true)}
      >
        <FileCode2 size={14} />
        Import TOML
      </button>
      <button
        class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
        onclick={downloadToml}
      >
        <Copy size={14} />
        Export TOML
      </button>
    </div>
  </div>

  <!-- TOML Import Modal -->
  {#if showTomlImport}
    <div
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onclick={(e) => {
        if (e.target === e.currentTarget) showTomlImport = false;
      }}
      onkeydown={(e) => {
        if (e.key === 'Escape') showTomlImport = false;
      }}
    >
      <div class="w-full max-w-2xl rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-lg font-semibold text-white">Import TOML Configuration</h3>
          <button
            class="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            onclick={() => (showTomlImport = false)}
          >
            <X size={18} />
          </button>
        </div>
        <textarea
          bind:value={tomlInput}
          rows="12"
          class="w-full rounded-lg border border-white/10 bg-slate-950 p-3 font-mono text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
          placeholder="Paste TOML configuration here..."></textarea>
        {#if tomlErrors.length > 0}
          <div class="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            {#each tomlErrors as error, i (i)}
              <p class="text-sm text-red-300">{error.field}: {error.message}</p>
            {/each}
          </div>
        {/if}
        <div class="mt-4 flex justify-end gap-3">
          <button
            class="rounded-lg border border-white/10 bg-slate-800 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
            onclick={() => (showTomlImport = false)}
          >
            Cancel
          </button>
          <button
            class="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500"
            onclick={importToml}
          >
            Import
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Form -->
  <div class="flex flex-col gap-4">
    <!-- Basics Section -->
    <div class="rounded-xl border border-white/10 bg-slate-900/60">
      <button
        class="flex w-full items-center justify-between px-5 py-3 text-left"
        onclick={() => toggleSection('basics')}
      >
        <span class="text-sm font-medium text-white">Basics</span>
        {#if expandedSections.basics}<ChevronDown
            size={16}
            class="text-slate-400"
          />{:else}<ChevronRight size={16} class="text-slate-400" />{/if}
      </button>
      {#if expandedSections.basics}
        <div class="border-t border-white/5 px-5 py-4">
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                for="vm-name"
                class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                Machine Name <span class="text-red-400">*</span>
              </label>
              <input
                id="vm-name"
                type="text"
                bind:value={config.name}
                placeholder="my-vm"
                class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                disabled={mode === 'edit'}
              />
            </div>
            <div>
              <label
                for="vm-image"
                class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                Image
              </label>
              <div class="flex gap-2">
                <input
                  id="vm-image"
                  type="text"
                  bind:value={config.image}
                  placeholder="alpine, nginx, etc."
                  class="flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                />
                <button
                  class="flex items-center gap-1 rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
                  onclick={() => (pickerOpen = true)}
                >
                  <Search size={14} />
                  Browse
                </button>
              </div>
            </div>
            <div>
              <label
                for="vm-tag"
                class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                Tag
              </label>
              <input
                id="vm-tag"
                type="text"
                bind:value={config.tag}
                placeholder="latest"
                class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>
            <div>
              <label
                for="vm-from"
                class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                From (.smolmachine)
              </label>
              <input
                id="vm-from"
                type="text"
                bind:value={config.from}
                placeholder="/path/to/file.smolmachine"
                class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>
          </div>
          {#if mode === 'edit' && (config.image !== initialConfig?.image || config.tag !== initialConfig?.tag || config.from !== initialConfig?.from)}
            <div
              class="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"
            >
              <AlertTriangle size={16} class="mt-0.5 shrink-0 text-amber-400" />
              <p class="text-xs text-amber-300">
                Changing image, tag, or from requires VM recreation.
              </p>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Resources Section -->
    <div class="rounded-xl border border-white/10 bg-slate-900/60">
      <button
        class="flex w-full items-center justify-between px-5 py-3 text-left"
        onclick={() => toggleSection('resources')}
      >
        <span class="text-sm font-medium text-white">Resources</span>
        {#if expandedSections.resources}<ChevronDown
            size={16}
            class="text-slate-400"
          />{:else}<ChevronRight size={16} class="text-slate-400" />{/if}
      </button>
      {#if expandedSections.resources}
        <div class="border-t border-white/5 px-5 py-4">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label
                for="vm-cpus"
                class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                CPUs
              </label>
              <input
                id="vm-cpus"
                type="number"
                bind:value={config.cpus}
                min="1"
                max="64"
                class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
              />
            </div>
            <div>
              <label
                for="vm-memory"
                class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                Memory (MiB)
              </label>
              <input
                id="vm-memory"
                type="number"
                bind:value={config.memory}
                min="64"
                class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
              />
            </div>
            <div>
              <label
                for="vm-storage"
                class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                Storage (GiB)
              </label>
              <input
                id="vm-storage"
                type="number"
                bind:value={config.storage}
                min="1"
                class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
              />
            </div>
            <div>
              <label
                for="vm-overlay"
                class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                Overlay (GiB)
              </label>
              <input
                id="vm-overlay"
                type="number"
                bind:value={config.overlay}
                min="1"
                class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
              />
            </div>
          </div>
          <div class="mt-4 flex flex-wrap gap-4">
            <label class="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                bind:checked={config.net}
                class="rounded border-slate-600 bg-slate-950 text-cyan-500 focus:ring-cyan-400"
              />
              Enable Network
            </label>
            <label class="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                bind:checked={config.gpu}
                class="rounded border-slate-600 bg-slate-950 text-cyan-500 focus:ring-cyan-400"
              />
              Enable GPU
            </label>
            <label class="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                bind:checked={config.sshAgent}
                class="rounded border-slate-600 bg-slate-950 text-cyan-500 focus:ring-cyan-400"
              />
              SSH Agent Forwarding
            </label>
          </div>
          {#if config.gpu}
            <div class="mt-3">
              <label
                for="vm-gpu-vram"
                class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                GPU VRAM (MiB)
              </label>
              <input
                id="vm-gpu-vram"
                type="number"
                bind:value={config.gpuVram}
                min="1"
                placeholder="4096"
                class="w-full max-w-xs rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-400 focus:outline-none"
              />
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Network Section -->
    <div class="rounded-xl border border-white/10 bg-slate-900/60">
      <button
        class="flex w-full items-center justify-between px-5 py-3 text-left"
        onclick={() => toggleSection('network')}
      >
        <span class="text-sm font-medium text-white">Network &amp; Ports</span>
        {#if expandedSections.network}<ChevronDown
            size={16}
            class="text-slate-400"
          />{:else}<ChevronRight size={16} class="text-slate-400" />{/if}
      </button>
      {#if expandedSections.network}
        <div class="border-t border-white/5 px-5 py-4">
          <!-- Port mappings -->
          <div class="mb-4">
            <span class="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
              Port Mappings
            </span>
            {#if config.ports && config.ports.length > 0}
              <div class="flex flex-col gap-2 mb-2">
                {#each config.ports as port, i (i)}
                  <div class="flex items-center gap-2">
                    <span class="text-sm text-white">{port.host}:{port.guest}</span>
                    <button
                      class="rounded p-1 text-red-400 transition hover:bg-red-500/10"
                      onclick={() => removePort(i)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
            <div class="flex gap-2">
              <input
                type="number"
                bind:value={newPortHost}
                placeholder="Host port"
                min="1"
                max="65535"
                class="w-32 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
              <span class="self-center text-slate-500">:</span>
              <input
                type="number"
                bind:value={newPortGuest}
                placeholder="Guest port"
                min="1"
                max="65535"
                class="w-32 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
              <button
                class="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
                onclick={addPort}
              >
                <Plus size={14} />
                Add
              </button>
            </div>
          </div>

          <!-- Allow hosts -->
          <div class="mb-4">
            <span class="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
              Allowed Hosts
            </span>
            {#if config.allowHosts && config.allowHosts.length > 0}
              <div class="flex flex-wrap gap-2 mb-2">
                {#each config.allowHosts as host, i (i)}
                  <span
                    class="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300"
                  >
                    {host}
                    <button
                      class="text-red-400 hover:text-red-300"
                      onclick={() => removeAllowHost(i)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                {/each}
              </div>
            {/if}
            <div class="flex gap-2">
              <input
                type="text"
                bind:value={newAllowHost}
                placeholder="github.com"
                class="flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
              <button
                class="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
                onclick={addAllowHost}
              >
                <Plus size={14} />
                Add
              </button>
            </div>
          </div>

          <!-- Allow CIDRs -->
          <div>
            <span class="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
              Allowed CIDRs
            </span>
            {#if config.allowCidrs && config.allowCidrs.length > 0}
              <div class="flex flex-wrap gap-2 mb-2">
                {#each config.allowCidrs as cidr, i (i)}
                  <span
                    class="inline-flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-300"
                  >
                    {cidr}
                    <button
                      class="text-red-400 hover:text-red-300"
                      onclick={() => removeAllowCidr(i)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                {/each}
              </div>
            {/if}
            <div class="flex gap-2">
              <input
                type="text"
                bind:value={newAllowCidr}
                placeholder="10.0.0.0/8"
                class="flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
              <button
                class="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
                onclick={addAllowCidr}
              >
                <Plus size={14} />
                Add
              </button>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Volumes Section -->
    <div class="rounded-xl border border-white/10 bg-slate-900/60">
      <button
        class="flex w-full items-center justify-between px-5 py-3 text-left"
        onclick={() => toggleSection('volumes')}
      >
        <span class="text-sm font-medium text-white">Volumes</span>
        {#if expandedSections.volumes}<ChevronDown
            size={16}
            class="text-slate-400"
          />{:else}<ChevronRight size={16} class="text-slate-400" />{/if}
      </button>
      {#if expandedSections.volumes}
        <div class="border-t border-white/5 px-5 py-4">
          {#if config.volumes && config.volumes.length > 0}
            <div class="flex flex-col gap-2 mb-3">
              {#each config.volumes as vol, i (i)}
                <div class="flex items-center gap-2 text-sm text-white">
                  <span class="font-mono">{vol.host} → {vol.guest}</span>
                  {#if vol.readOnly}
                    <span class="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400"
                      >ro</span
                    >
                  {/if}
                  <button
                    class="rounded p-1 text-red-400 transition hover:bg-red-500/10"
                    onclick={() => removeVolume(i)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
          {#if sensitiveMountWarnings.length > 0}
            <div
              class="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"
              role="alert"
            >
              <AlertTriangle size={16} class="mt-0.5 shrink-0 text-amber-400" />
              <div>
                <p class="text-xs font-medium text-amber-300">Sensitive host mount detected</p>
                <ul class="mt-1 list-disc pl-4">
                  {#each sensitiveMountWarnings as warning (warning.path)}
                    <li class="text-xs text-amber-200">
                      <span class="font-mono">{warning.path}</span> — {warning.reason}
                    </li>
                  {/each}
                </ul>
                <p class="mt-1 text-xs text-amber-300/80">
                  This mount may expose sensitive host data. You can still proceed if this is
                  intentional.
                </p>
              </div>
            </div>
          {/if}
          <div class="flex flex-wrap gap-2">
            <input
              type="text"
              bind:value={newVolumeHost}
              placeholder="/host/path"
              class="flex-1 min-w-[140px] rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
            />
            <input
              type="text"
              bind:value={newVolumeGuest}
              placeholder="/guest/path"
              class="flex-1 min-w-[140px] rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
            />
            <label class="flex items-center gap-1.5 text-xs text-slate-400">
              <input
                type="checkbox"
                bind:checked={newVolumeReadOnly}
                class="rounded border-slate-600 bg-slate-950 text-cyan-500"
              />
              Read-only
            </label>
            <button
              class="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
              onclick={addVolume}
            >
              <Plus size={14} />
              Add
            </button>
          </div>
        </div>
      {/if}
    </div>

    <!-- Environment Section -->
    <div class="rounded-xl border border-white/10 bg-slate-900/60">
      <button
        class="flex w-full items-center justify-between px-5 py-3 text-left"
        onclick={() => toggleSection('environment')}
      >
        <span class="text-sm font-medium text-white">Environment Variables</span>
        {#if expandedSections.environment}<ChevronDown
            size={16}
            class="text-slate-400"
          />{:else}<ChevronRight size={16} class="text-slate-400" />{/if}
      </button>
      {#if expandedSections.environment}
        <div class="border-t border-white/5 px-5 py-4">
          {#if config.env && Object.keys(config.env).length > 0}
            <div class="flex flex-col gap-2 mb-3">
              {#each Object.entries(config.env) as [key, value] (key)}
                <div class="flex items-center gap-2 text-sm text-white">
                  <span class="font-mono text-cyan-300">{key}</span>
                  <span class="text-slate-500">=</span>
                  <span class="font-mono">{value}</span>
                  <button
                    class="rounded p-1 text-red-400 transition hover:bg-red-500/10"
                    onclick={() => removeEnv(key)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              {/each}
            </div>
          {/if}
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={newEnvKey}
              placeholder="KEY"
              class="w-36 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
            />
            <span class="self-center text-slate-500">=</span>
            <input
              type="text"
              bind:value={newEnvValue}
              placeholder="value"
              class="flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
            />
            <button
              class="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
              onclick={addEnv}
            >
              <Plus size={14} />
              Add
            </button>
          </div>
        </div>
      {/if}
    </div>

    <!-- Commands Section -->
    <div class="rounded-xl border border-white/10 bg-slate-900/60">
      <button
        class="flex w-full items-center justify-between px-5 py-3 text-left"
        onclick={() => toggleSection('commands')}
      >
        <span class="text-sm font-medium text-white">Commands &amp; Init</span>
        {#if expandedSections.commands}<ChevronDown
            size={16}
            class="text-slate-400"
          />{:else}<ChevronRight size={16} class="text-slate-400" />{/if}
      </button>
      {#if expandedSections.commands}
        <div class="border-t border-white/5 px-5 py-4">
          <div class="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                for="vm-workdir"
                class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                Working Directory
              </label>
              <input
                id="vm-workdir"
                type="text"
                bind:value={config.workdir}
                placeholder="/app"
                class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>
            <div>
              <label
                for="vm-entrypoint"
                class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                Entrypoint
              </label>
              <input
                id="vm-entrypoint"
                type="text"
                bind:value={config.entrypoint}
                placeholder="/bin/sh"
                class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>
            <div>
              <label
                for="vm-cmd"
                class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
              >
                Command (cmd)
              </label>
              <input
                id="vm-cmd"
                type="text"
                bind:value={config.cmd}
                placeholder="-c echo hello"
                class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
            </div>
          </div>
          {#if mode === 'edit' && (config.entrypoint !== initialConfig?.entrypoint || config.cmd !== initialConfig?.cmd)}
            <div
              class="mt-3 flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"
            >
              <AlertTriangle size={16} class="mt-0.5 shrink-0 text-amber-400" />
              <p class="text-xs text-amber-300">
                Changing entrypoint or cmd requires VM recreation.
              </p>
            </div>
          {/if}

          <!-- Init commands -->
          <div class="mt-4">
            <span class="mb-2 block text-xs font-medium uppercase tracking-wider text-slate-400">
              Init Commands
            </span>
            {#if config.init && config.init.length > 0}
              <div class="flex flex-col gap-2 mb-2">
                {#each config.init as cmd, i (i)}
                  <div class="flex items-center gap-2 text-sm text-white">
                    <span class="font-mono">{cmd}</span>
                    <button
                      class="rounded p-1 text-red-400 transition hover:bg-red-500/10"
                      onclick={() => removeInitCommand(i)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                {/each}
              </div>
            {/if}
            <div class="flex gap-2">
              <input
                type="text"
                bind:value={newInitCommand}
                placeholder="Command to run on every start"
                class="flex-1 rounded-lg border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
              />
              <button
                class="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
                onclick={addInitCommand}
              >
                <Plus size={14} />
                Add
              </button>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Advanced / TOML Preview Section -->
    <div class="rounded-xl border border-white/10 bg-slate-900/60">
      <button
        class="flex w-full items-center justify-between px-5 py-3 text-left"
        onclick={() => toggleSection('advanced')}
      >
        <span class="text-sm font-medium text-white">TOML Preview</span>
        {#if expandedSections.advanced}<ChevronDown
            size={16}
            class="text-slate-400"
          />{:else}<ChevronRight size={16} class="text-slate-400" />{/if}
      </button>
      {#if expandedSections.advanced}
        <div class="border-t border-white/5 px-5 py-4">
          <div class="flex gap-2 mb-3">
            <button
              class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
              onclick={copyTomlToClipboard}
            >
              <Copy size={14} />
              Copy
            </button>
            <button
              class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
              onclick={downloadToml}
            >
              <FileCode2 size={14} />
              Download
            </button>
          </div>
          <pre
            class="max-h-64 overflow-auto rounded-lg border border-white/5 bg-slate-950 p-3 font-mono text-xs text-slate-300">{configToTomlLocal()}</pre>
        </div>
      {/if}
    </div>
  </div>

  <!-- Action buttons -->
  <div class="flex items-center justify-end gap-3 pt-2">
    <button
      class="rounded-lg border border-white/10 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
      onclick={onCancel}
    >
      Cancel
    </button>
    <button
      class="flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
      onclick={handleSave}
      disabled={saving || !config.name.trim()}
    >
      {#if saving}
        <Loader2 size={16} class="animate-spin" />
      {/if}
      {mode === 'create'
        ? 'Create VM'
        : mode === 'copy'
          ? 'Create Copy'
          : mode === 'recreate'
            ? 'Recreate VM'
            : 'Save Changes'}
    </button>
  </div>
</div>
