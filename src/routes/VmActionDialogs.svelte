<script lang="ts">
  import ActionDialog from '$lib/components/ActionDialog.svelte';
  import type { SmolVmExportResult, SmolVmMachine } from '$lib/types';

  let {
    csrfToken,
    onChanged
  }: {
    csrfToken: string;
    onChanged?: () => void;
  } = $props();

  // Resize
  let resizeOpen = $state(false);
  let resizeTarget: SmolVmMachine | null = $state(null);
  let resizeStorage = $state<number | undefined>(undefined);
  let resizeOverlay = $state<number | undefined>(undefined);
  let resizeLoading = $state(false);
  let resizeError: string | null = $state(null);

  // Fork
  let forkOpen = $state(false);
  let forkTarget: SmolVmMachine | null = $state(null);
  let forkName = $state('');
  let forkLoading = $state(false);
  let forkError: string | null = $state(null);

  // Export
  let exportOpen = $state(false);
  let exportTarget: SmolVmMachine | null = $state(null);
  let exportRepo = $state('');
  let exportTag = $state('');
  let exportPushToken = $state('');
  let exportLoading = $state(false);
  let exportError: string | null = $state(null);
  let exportResult: SmolVmExportResult | null = $state(null);

  // Start
  let startOpen = $state(false);
  let startTarget: SmolVmMachine | null = $state(null);
  let startForkable = $state(false);
  let startLoading = $state(false);
  let startError: string | null = $state(null);

  // File upload
  let uploadOpen = $state(false);
  let uploadTarget: SmolVmMachine | null = $state(null);
  let uploadPath = $state('');
  let uploadContent = $state('');
  let uploadLoading = $state(false);
  let uploadError: string | null = $state(null);
  let uploadSuccess: string | null = $state(null);

  function machineStatus(m: SmolVmMachine | null): string {
    return m?.status ?? m?.state ?? 'unknown';
  }

  function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  async function submitResize() {
    if (!resizeTarget) return;
    if (!resizeStorage && !resizeOverlay) {
      resizeError = 'Provide at least one of storage or overlay.';
      return;
    }
    resizeLoading = true;
    resizeError = null;
    try {
      const body: Record<string, unknown> = {};
      if (typeof resizeStorage === 'number' && resizeStorage > 0) body.storageGb = resizeStorage;
      if (typeof resizeOverlay === 'number' && resizeOverlay > 0) body.overlayGb = resizeOverlay;
      const response = await fetch(
        `/api/smolvm/machines/${encodeURIComponent(resizeTarget.name)}/resize`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          body: JSON.stringify(body)
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        const message =
          data?.error ??
          data?.message ??
          (response.status === 409
            ? 'Machine must be stopped before resizing.'
            : `Resize failed (${response.status})`);
        throw new Error(message);
      }
      resizeOpen = false;
      onChanged?.();
    } catch (err) {
      resizeError = err instanceof Error ? err.message : 'Resize failed';
    } finally {
      resizeLoading = false;
    }
  }

  async function submitFork() {
    if (!forkTarget) return;
    if (!forkName.trim()) {
      forkError = 'Clone name is required.';
      return;
    }
    forkLoading = true;
    forkError = null;
    try {
      const response = await fetch(
        `/api/smolvm/machines/${encodeURIComponent(forkTarget.name)}/fork`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          body: JSON.stringify({ name: forkName.trim() })
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? data?.message ?? `Fork failed (${response.status})`);
      }
      forkOpen = false;
      onChanged?.();
    } catch (err) {
      forkError = err instanceof Error ? err.message : 'Fork failed';
    } finally {
      forkLoading = false;
    }
  }

  async function submitExport() {
    if (!exportTarget) return;
    exportLoading = true;
    exportError = null;
    exportResult = null;
    try {
      const body: Record<string, unknown> = {};
      if (exportRepo.trim()) body.repo = exportRepo.trim();
      if (exportTag.trim()) body.tag = exportTag.trim();
      if (exportPushToken.trim()) body.pushToken = exportPushToken.trim();
      const response = await fetch(
        `/api/smolvm/machines/${encodeURIComponent(exportTarget.name)}/export`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          body: JSON.stringify(body)
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? data?.message ?? `Export failed (${response.status})`);
      }
      exportResult = {
        digest: String(data?.digest ?? ''),
        sizeBytes: Number(data?.sizeBytes ?? 0),
        platform: String(data?.platform ?? '')
      };
    } catch (err) {
      exportError = err instanceof Error ? err.message : 'Export failed';
    } finally {
      exportLoading = false;
    }
  }

  async function submitStart() {
    if (!startTarget) return;
    startLoading = true;
    startError = null;
    try {
      const body: Record<string, unknown> = {};
      if (startForkable) body.forkable = true;
      const response = await fetch(
        `/api/smolvm/machines/${encodeURIComponent(startTarget.name)}/start`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          body: JSON.stringify(body)
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? data?.message ?? `Start failed (${response.status})`);
      }
      startOpen = false;
      onChanged?.();
    } catch (err) {
      startError = err instanceof Error ? err.message : 'Start failed';
    } finally {
      startLoading = false;
    }
  }

  async function submitUpload() {
    if (!uploadTarget) return;
    if (!uploadPath.trim()) {
      uploadError = 'Guest path is required.';
      return;
    }
    uploadLoading = true;
    uploadError = null;
    uploadSuccess = null;
    try {
      const response = await fetch(
        `/api/smolvm/machines/${encodeURIComponent(uploadTarget.name)}/files?path=${encodeURIComponent(uploadPath.trim())}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-csrf-token': csrfToken
          },
          body: JSON.stringify({ content: uploadContent })
        }
      );
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error ?? data?.message ?? `Upload failed (${response.status})`);
      }
      uploadSuccess = `Wrote ${uploadPath.trim()} on ${uploadTarget.name}.`;
      uploadPath = '';
      uploadContent = '';
    } catch (err) {
      uploadError = err instanceof Error ? err.message : 'Upload failed';
    } finally {
      uploadLoading = false;
    }
  }

  export function openResize(machine: SmolVmMachine) {
    resizeTarget = machine;
    resizeStorage = typeof machine.storage === 'number' ? machine.storage : undefined;
    resizeOverlay = typeof machine.overlay === 'number' ? machine.overlay : undefined;
    resizeError = null;
    resizeOpen = true;
  }
  export function openFork(machine: SmolVmMachine) {
    forkTarget = machine;
    forkName = '';
    forkError = null;
    forkOpen = true;
  }
  export function openExport(machine: SmolVmMachine) {
    exportTarget = machine;
    exportRepo = '';
    exportTag = '';
    exportPushToken = '';
    exportError = null;
    exportResult = null;
    exportOpen = true;
  }
  export function openStart(machine: SmolVmMachine) {
    startTarget = machine;
    startForkable = false;
    startError = null;
    startOpen = true;
  }
  export function openUpload(machine: SmolVmMachine) {
    uploadTarget = machine;
    uploadPath = '';
    uploadContent = '';
    uploadError = null;
    uploadSuccess = null;
    uploadOpen = true;
  }
</script>

<ActionDialog
  bind:open={resizeOpen}
  title="Resize machine"
  subtitle={resizeTarget ? `Expanding storage/overlay for "${resizeTarget.name}" (grow-only).` : ''}
  confirmLabel="Resize"
  loading={resizeLoading}
  error={resizeError}
  onConfirm={submitResize}
  onCancel={() => (resizeOpen = false)}
>
  <div class="grid gap-4 sm:grid-cols-2">
    <div>
      <label
        for="resize-storage"
        class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
      >
        Storage (GiB)
      </label>
      <input
        id="resize-storage"
        type="number"
        bind:value={resizeStorage}
        min="1"
        placeholder="current"
        class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
      />
    </div>
    <div>
      <label
        for="resize-overlay"
        class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
      >
        Overlay (GiB)
      </label>
      <input
        id="resize-overlay"
        type="number"
        bind:value={resizeOverlay}
        min="1"
        placeholder="current"
        class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
      />
    </div>
  </div>
  {#if resizeTarget && machineStatus(resizeTarget) !== 'stopped'}
    <p class="mt-3 text-xs text-amber-300">
      Resize only succeeds on a stopped machine. Stop it first.
    </p>
  {/if}
</ActionDialog>

<ActionDialog
  bind:open={forkOpen}
  title="Fork machine"
  subtitle={forkTarget ? `Create a clone from "${forkTarget.name}".` : ''}
  confirmLabel="Fork"
  loading={forkLoading}
  error={forkError}
  onConfirm={submitFork}
  onCancel={() => (forkOpen = false)}
>
  <div>
    <label
      for="fork-name"
      class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
    >
      Clone name <span class="text-red-400">*</span>
    </label>
    <input
      id="fork-name"
      type="text"
      bind:value={forkName}
      placeholder="my-clone"
      class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
    />
  </div>
  <p class="mt-3 text-xs text-slate-400">
    The source must have been started with <span class="font-mono text-cyan-300">forkable</span>
    enabled; otherwise SmolVM rejects the fork.
  </p>
</ActionDialog>

<ActionDialog
  bind:open={exportOpen}
  title="Export machine"
  subtitle={exportTarget ? `Commit "${exportTarget.name}" as an OCI image.` : ''}
  confirmLabel={exportResult ? 'Done' : 'Export'}
  loading={exportLoading}
  error={exportError}
  onConfirm={() => (exportResult ? (exportOpen = false) : submitExport())}
  onCancel={() => (exportOpen = false)}
>
  {#if exportResult}
    <div
      class="flex flex-col gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-3 text-sm"
    >
      <p class="text-xs uppercase tracking-wider text-emerald-300">Exported</p>
      <p class="break-all font-mono text-xs text-emerald-100">{exportResult.digest}</p>
      <div class="flex gap-3 text-xs text-slate-300">
        <span>{formatBytes(exportResult.sizeBytes)}</span>
        {#if exportResult.platform}
          <span class="text-slate-500">• {exportResult.platform}</span>
        {/if}
      </div>
    </div>
  {:else}
    <div class="flex flex-col gap-3">
      <div>
        <label
          for="export-repo"
          class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
        >
          Repo
        </label>
        <input
          id="export-repo"
          type="text"
          bind:value={exportRepo}
          placeholder="registry.example.com/user/image"
          class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
        />
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div>
          <label
            for="export-tag"
            class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
          >
            Tag
          </label>
          <input
            id="export-tag"
            type="text"
            bind:value={exportTag}
            placeholder="latest"
            class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
          />
        </div>
        <div>
          <label
            for="export-push-token"
            class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
          >
            Push token
          </label>
          <input
            id="export-push-token"
            type="password"
            bind:value={exportPushToken}
            placeholder="optional"
            class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
          />
        </div>
      </div>
    </div>
    {#if exportTarget && machineStatus(exportTarget) !== 'stopped'}
      <p class="mt-3 text-xs text-amber-300">
        Export only succeeds on a stopped machine. Stop it first.
      </p>
    {/if}
  {/if}
</ActionDialog>

<ActionDialog
  bind:open={startOpen}
  title="Start machine"
  subtitle={startTarget ? `Booting "${startTarget.name}".` : ''}
  confirmLabel="Start"
  loading={startLoading}
  error={startError}
  onConfirm={submitStart}
  onCancel={() => (startOpen = false)}
>
  <label
    class="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 bg-slate-950 px-3 py-3"
  >
    <input
      type="checkbox"
      bind:checked={startForkable}
      class="rounded border-slate-600 bg-slate-950 text-cyan-500 focus:ring-cyan-400"
    />
    <div class="flex-1">
      <p class="text-sm text-white">Forkable</p>
      <p class="text-xs text-slate-400">
        Allow this machine to be forked into clones while running.
      </p>
    </div>
  </label>
</ActionDialog>

<ActionDialog
  bind:open={uploadOpen}
  title="Upload file"
  subtitle={uploadTarget ? `Write a file into "${uploadTarget.name}".` : ''}
  confirmLabel={uploadSuccess ? 'Close' : 'Upload'}
  loading={uploadLoading}
  error={uploadError}
  onConfirm={() => (uploadSuccess ? (uploadOpen = false) : submitUpload())}
  onCancel={() => (uploadOpen = false)}
>
  {#if uploadSuccess}
    <div
      class="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-300"
    >
      {uploadSuccess}
    </div>
  {:else}
    <div class="flex flex-col gap-3">
      <div>
        <label
          for="upload-path"
          class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
        >
          Guest path <span class="text-red-400">*</span>
        </label>
        <input
          id="upload-path"
          type="text"
          bind:value={uploadPath}
          placeholder="/etc/app/config.json"
          class="w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
        />
      </div>
      <div>
        <label
          for="upload-content"
          class="mb-1.5 block text-xs font-medium uppercase tracking-wider text-slate-400"
        >
          Content
        </label>
        <textarea
          id="upload-content"
          bind:value={uploadContent}
          rows="8"
          class="w-full rounded-lg border border-white/10 bg-slate-950 p-3 font-mono text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
          placeholder="file contents..."></textarea>
      </div>
    </div>
  {/if}
</ActionDialog>
