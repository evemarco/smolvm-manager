<script lang="ts">
  import {
    Search,
    Package,
    Tag,
    Clock,
    Cpu,
    HardDrive,
    AlertTriangle,
    ChevronLeft,
    ChevronRight,
    X,
    Shield,
    Loader2,
    ExternalLink
  } from '@lucide/svelte';
  import { toasts } from '$lib/toast';
  import type { ImagePickerSelection } from '$lib/types';

  let {
    onSelect,
    onClose
  }: {
    onSelect: (selection: ImagePickerSelection) => void;
    onClose: () => void;
  } = $props();

  // Search state
  let searchQuery = $state('');
  let searchLoading = $state(false);
  let searchError: string | null = $state(null);
  let searchResults: Array<{
    name: string;
    namespace: string;
    description?: string;
    is_official?: boolean;
    star_count?: number;
    pull_count?: number;
  }> = $state([]);
  let searchPage = $state(1);
  let searchPageSize = $state(25);
  let searchNextPage = $state<number | undefined>(undefined);
  let searchTotalCount = $state<number | undefined>(undefined);

  // Tag state
  let selectedRepo: { namespace: string; name: string } | null = $state(null);
  let tagLoading = $state(false);
  let tagError: string | null = $state(null);
  let tags: Array<{
    name: string;
    digest?: string;
    images: Array<{ architecture: string; os?: string; size?: number }>;
    lastUpdated?: string;
    lastPushed?: string;
    size?: number;
  }> = $state([]);
  let tagPage = $state(1);
  let tagPageSize = $state(25);
  let tagNextPage = $state<number | undefined>(undefined);
  let tagTotalCount = $state<number | undefined>(undefined);

  // Rate limit state
  let rateLimitRetryAfter = $state<number | undefined>(undefined);

  // Sort + official filter state
  let sortOption = $state<'stars' | 'pulls' | 'name'>('stars');
  let officialOnly = $state(false);

  let sortedSearchResults = $derived.by(() => {
    let list = searchResults;
    if (officialOnly) {
      list = list.filter((r) => r.is_official === true);
    }
    const sorted = [...list];
    if (sortOption === 'stars') {
      sorted.sort((a, b) => (b.star_count ?? 0) - (a.star_count ?? 0));
    } else if (sortOption === 'pulls') {
      sorted.sort((a, b) => (b.pull_count ?? 0) - (a.pull_count ?? 0));
    } else {
      sorted.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  });

  let searchTotalPages = $derived(
    searchTotalCount !== undefined ? Math.ceil(searchTotalCount / searchPageSize) : undefined
  );
  let tagTotalPages = $derived(
    tagTotalCount !== undefined ? Math.ceil(tagTotalCount / tagPageSize) : undefined
  );

  function dockerHubUrl(namespace: string, name: string): string {
    return namespace === 'library'
      ? `https://hub.docker.com/_/${name}`
      : `https://hub.docker.com/r/${namespace}/${name}`;
  }

  function formatBytes(bytes?: number): string {
    if (bytes === undefined || bytes === null) return '-';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }

  function formatDate(dateStr?: string): string {
    if (!dateStr) return '-';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  }

  function getArchitectures(tag: (typeof tags)[number]): string {
    if (!tag.images || tag.images.length === 0) return '-';
    const archs = tag.images.map((i) => i.architecture).filter(Boolean);
    const unique = [...new Set(archs)];
    return unique.slice(0, 3).join(', ') + (unique.length > 3 ? '...' : '');
  }

  async function performSearch(page = 1) {
    if (!searchQuery.trim()) return;
    searchLoading = true;
    searchError = null;
    rateLimitRetryAfter = undefined;

    try {
      const officialParam = officialOnly ? '&official=1' : '';
      const response = await fetch(
        `/api/smolvm/docker-hub/search?q=${encodeURIComponent(searchQuery.trim())}&page=${page}&page_size=${searchPageSize}${officialParam}`
      );
      const body = await response.json();

      if (!response.ok) {
        if (body.code === 'DOCKER_HUB_RATE_LIMITED') {
          rateLimitRetryAfter = body.retryAfter;
          throw new Error(body.message ?? 'Docker Hub rate limit exceeded.');
        }
        throw new Error(body.message ?? `Search failed (${response.status})`);
      }

      searchResults = body.results ?? [];
      searchPage = body.page ?? page;
      searchPageSize = body.pageSize ?? searchPageSize;
      searchNextPage = body.nextPage;
      searchTotalCount = body.totalCount;
    } catch (err) {
      searchError = err instanceof Error ? err.message : 'Search failed';
      toasts.push(searchError, 'error');
    } finally {
      searchLoading = false;
    }
  }

  async function loadTags(namespace: string, repo: string, page = 1) {
    selectedRepo = { namespace, name: repo };
    tagLoading = true;
    tagError = null;
    tags = [];
    rateLimitRetryAfter = undefined;

    try {
      const response = await fetch(
        `/api/smolvm/docker-hub/tags?namespace=${encodeURIComponent(namespace)}&repo=${encodeURIComponent(repo)}&page=${page}&page_size=${tagPageSize}`
      );
      const body = await response.json();

      if (!response.ok) {
        if (body.code === 'DOCKER_HUB_RATE_LIMITED') {
          rateLimitRetryAfter = body.retryAfter;
          throw new Error(body.message ?? 'Docker Hub rate limit exceeded.');
        }
        throw new Error(body.message ?? `Tag listing failed (${response.status})`);
      }

      tags = body.results ?? [];
      tagPage = body.page ?? page;
      tagPageSize = body.pageSize ?? tagPageSize;
      tagNextPage = body.nextPage;
      tagTotalCount = body.totalCount;
    } catch (err) {
      tagError = err instanceof Error ? err.message : 'Tag listing failed';
      toasts.push(tagError, 'error');
    } finally {
      tagLoading = false;
    }
  }

  function selectTag(tagName: string) {
    if (!selectedRepo) return;
    const fullName = `${selectedRepo.namespace}/${selectedRepo.name}:${tagName}`;
    onSelect({
      namespace: selectedRepo.namespace,
      repository: selectedRepo.name,
      tag: tagName,
      fullName
    });
    onClose();
    resetState();
  }

  function resetState() {
    searchQuery = '';
    searchResults = [];
    searchError = null;
    searchPage = 1;
    searchNextPage = undefined;
    searchTotalCount = undefined;
    selectedRepo = null;
    tags = [];
    tagError = null;
    tagPage = 1;
    tagNextPage = undefined;
    tagTotalCount = undefined;
    rateLimitRetryAfter = undefined;
    sortOption = 'stars';
    officialOnly = false;
  }

  function goBackToSearch() {
    selectedRepo = null;
    tags = [];
    tagError = null;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
      resetState();
    }
  }

  // Global escape listener when modal is open
  $effect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        resetState();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
  onclick={(e) => {
    if (e.target === e.currentTarget) {
      onClose();
      resetState();
    }
  }}
  onkeydown={handleKeydown}
>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="flex h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-white/10 bg-slate-900 shadow-2xl"
    onclick={(e) => e.stopPropagation()}
  >
    <!-- Header -->
    <div class="flex items-center justify-between border-b border-white/10 px-6 py-4">
      <h2 class="text-lg font-semibold text-white">
        {#if selectedRepo}
          <button
            class="mr-2 inline-flex items-center rounded-lg p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            onclick={goBackToSearch}
            aria-label="Back to search results"
          >
            <ChevronLeft size={18} />
          </button>
          {selectedRepo.namespace}/{selectedRepo.name}
        {:else}
          Docker Hub Image Search
        {/if}
      </h2>
      <button
        class="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white"
        onclick={() => {
          onClose();
          resetState();
        }}
        aria-label="Close picker"
      >
        <X size={18} />
      </button>
    </div>

    <!-- Body -->
    <div class="flex flex-1 flex-col gap-4 overflow-hidden p-6">
      {#if !selectedRepo}
        <!-- Search view -->
        <div class="flex gap-2">
          <div class="relative flex-1">
            <Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              type="text"
              placeholder="Search Docker Hub (e.g. alpine, nginx, node)"
              bind:value={searchQuery}
              onkeydown={(e) => e.key === 'Enter' && performSearch(1)}
              class="w-full rounded-lg border border-white/10 bg-slate-950 py-2.5 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
            />
          </div>
          <button
            class="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
            onclick={() => performSearch(1)}
            disabled={searchLoading || !searchQuery.trim()}
          >
            {#if searchLoading}
              <Loader2 size={16} class="animate-spin" />
            {:else}
              Search
            {/if}
          </button>
        </div>

        {#if searchError}
          <div
            class="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 py-8"
          >
            <AlertTriangle size={24} class="text-red-400" />
            <p class="text-sm text-red-300">{searchError}</p>
            {#if rateLimitRetryAfter}
              <p class="text-xs text-slate-400">Retry after {rateLimitRetryAfter} seconds</p>
            {/if}
            <button
              class="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
              onclick={() => performSearch(searchPage)}
            >
              Retry
            </button>
          </div>
        {:else if sortedSearchResults.length > 0}
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div class="flex flex-wrap items-center gap-3 text-slate-400">
              <label class="inline-flex items-center gap-1.5">
                <span class="text-slate-400">Sort</span>
                <select
                  bind:value={sortOption}
                  class="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-slate-200 focus:border-cyan-400 focus:outline-none"
                >
                  <option value="stars">Most stars</option>
                  <option value="pulls">Most pulls</option>
                  <option value="name">Name A-Z</option>
                </select>
              </label>
              <label class="inline-flex cursor-pointer items-center gap-1.5 text-slate-400">
                <input
                  type="checkbox"
                  bind:checked={officialOnly}
                  onchange={() => {
                    if (searchQuery.trim()) performSearch(1);
                  }}
                  class="size-3.5 cursor-pointer rounded border-white/20 bg-slate-800 text-cyan-500 focus:ring-cyan-400"
                />
                <span>Official images only</span>
              </label>
            </div>
            <span>
              {#if searchTotalCount !== undefined}
                {searchTotalCount} results
              {:else}
                {searchResults.length} results
              {/if}
            </span>
          </div>

          <div class="flex items-center justify-end text-xs text-slate-400">
            <div class="flex items-center gap-2">
              <button
                class="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-slate-300 transition hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                disabled={searchPage <= 1}
                onclick={() => performSearch(searchPage - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              <span>
                Page {searchPage}{#if searchTotalPages !== undefined} / {searchTotalPages}{/if}
              </span>
              <button
                class="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-slate-300 transition hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                disabled={!searchNextPage}
                onclick={() => performSearch(searchNextPage!)}
                aria-label="Next page"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto pr-1">
            <div class="flex flex-col gap-2">
              {#each sortedSearchResults as result (result.namespace + '/' + result.name)}
                <div
                  role="button"
                  tabindex="0"
                  class="flex items-start gap-3 rounded-xl border border-white/5 bg-slate-800/50 p-4 text-left transition hover:border-cyan-500/30 hover:bg-slate-800"
                  onclick={() => loadTags(result.namespace, result.name)}
                  onkeydown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      loadTags(result.namespace, result.name);
                    }
                  }}
                >
                  <div
                    class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-700"
                  >
                    <Package size={18} class="text-slate-400" />
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                      <span class="text-sm font-medium text-white">
                        {result.namespace}/{result.name}
                      </span>
                      {#if result.is_official}
                        <span
                          class="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300"
                        >
                          <Shield size={10} />
                          Official
                        </span>
                      {:else}
                        <span
                          class="inline-flex items-center rounded-full bg-slate-700 px-2 py-0.5 text-[10px] text-slate-400"
                        >
                          Community
                        </span>
                      {/if}
                      <!-- eslint-disable svelte/no-navigation-without-resolve -->
                      <a
                        href={dockerHubUrl(result.namespace, result.name)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onclick={(e) => e.stopPropagation()}
                        onkeydown={(e) => e.stopPropagation()}
                        class="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-700 hover:text-cyan-300"
                        aria-label="Open {result.namespace}/{result.name} on Docker Hub"
                      >
                        <ExternalLink size={14} />
                      </a>
                      <!-- eslint-enable svelte/no-navigation-without-resolve -->
                    </div>
                    {#if result.description}
                      <p class="mt-1 truncate text-xs text-slate-400">{result.description}</p>
                    {/if}
                    <div class="mt-2 flex items-center gap-3 text-[10px] text-slate-500">
                      {#if result.star_count !== undefined}
                        <span>{result.star_count.toLocaleString()} stars</span>
                      {/if}
                      {#if result.pull_count !== undefined}
                        <span>{result.pull_count.toLocaleString()} pulls</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {:else if !searchLoading && searchQuery.trim()}
          <div class="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
            <Search size={24} />
            <p class="text-sm">No results found for "{searchQuery}"</p>
          </div>
        {:else}
          <div class="flex flex-1 flex-col items-center justify-center gap-2 text-slate-500">
            <Package size={32} />
            <p class="text-sm">Search Docker Hub for images</p>
          </div>
        {/if}
      {:else}
        <!-- Tag view -->
        {#if tagError}
          <div
            class="flex flex-col items-center justify-center gap-3 rounded-xl border border-red-500/20 bg-red-500/5 py-8"
          >
            <AlertTriangle size={24} class="text-red-400" />
            <p class="text-sm text-red-300">{tagError}</p>
            {#if rateLimitRetryAfter}
              <p class="text-xs text-slate-400">Retry after {rateLimitRetryAfter} seconds</p>
            {/if}
            <button
              class="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 transition hover:bg-slate-700 hover:text-white"
              onclick={() => loadTags(selectedRepo!.namespace, selectedRepo!.name, tagPage)}
            >
              Retry
            </button>
          </div>
        {:else if tags.length > 0}
          <div class="flex items-center justify-between text-xs text-slate-400">
            <span>
              {#if tagTotalCount !== undefined}
                {tagTotalCount} tags
              {:else}
                {tags.length} tags
              {/if}
            </span>
            <div class="flex items-center gap-2">
              <button
                class="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-slate-300 transition hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                disabled={tagPage <= 1}
                onclick={() => loadTags(selectedRepo!.namespace, selectedRepo!.name, tagPage - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              <span>
                Page {tagPage}{#if tagTotalPages !== undefined} / {tagTotalPages}{/if}
              </span>
              <button
                class="rounded-lg border border-white/10 bg-slate-800 px-2 py-1 text-slate-300 transition hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
                disabled={!tagNextPage}
                onclick={() => loadTags(selectedRepo!.namespace, selectedRepo!.name, tagNextPage!)}
                aria-label="Next page"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto pr-1">
            <div class="flex flex-col gap-2">
              {#each tags as tag (tag.name)}
                <button
                  class="flex items-center justify-between rounded-xl border border-white/5 bg-slate-800/50 p-4 text-left transition hover:border-cyan-500/30 hover:bg-slate-800"
                  onclick={() => selectTag(tag.name)}
                >
                  <div class="flex items-start gap-3 min-w-0">
                    <div
                      class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-700"
                    >
                      <Tag size={18} class="text-slate-400" />
                    </div>
                    <div class="min-w-0">
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-medium text-white">{tag.name}</span>
                        {#if tag.digest}
                          <span class="truncate max-w-[200px] text-[10px] font-mono text-slate-500">
                            {tag.digest.slice(0, 19)}...
                          </span>
                        {/if}
                      </div>
                      <div
                        class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400"
                      >
                        <span class="inline-flex items-center gap-1">
                          <Cpu size={10} />
                          {getArchitectures(tag)}
                        </span>
                        {#if tag.size !== undefined}
                          <span class="inline-flex items-center gap-1">
                            <HardDrive size={10} />
                            {formatBytes(tag.size)}
                          </span>
                        {/if}
                        {#if tag.lastPushed}
                          <span class="inline-flex items-center gap-1">
                            <Clock size={10} />
                            {formatDate(tag.lastPushed)}
                          </span>
                        {/if}
                      </div>
                    </div>
                  </div>
                  <span
                    class="ml-2 shrink-0 rounded-lg bg-cyan-600/10 px-2.5 py-1 text-xs font-medium text-cyan-300"
                  >
                    Select
                  </span>
                </button>
              {/each}
            </div>
          </div>
        {:else if tagLoading}
          <div class="flex flex-1 flex-col items-center justify-center gap-3">
            <Loader2 size={28} class="animate-spin text-cyan-400" />
            <p class="text-sm text-slate-400">Loading tags...</p>
          </div>
        {:else}
          <div class="flex flex-1 flex-col items-center justify-center gap-2 text-slate-400">
            <Tag size={24} />
            <p class="text-sm">No tags found</p>
          </div>
        {/if}
      {/if}
    </div>

    <!-- Footer -->
    <div class="border-t border-white/10 px-6 py-3 text-xs text-slate-500">
      {#if selectedRepo}
        Trusted/verified status: metadata unavailable from public API
      {:else}
        Results from Docker Hub public API. Official image status is best-effort.
      {/if}
    </div>
  </div>
</div>
