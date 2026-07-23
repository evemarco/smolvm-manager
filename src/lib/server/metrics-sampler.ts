/**
 * Metrics sampler: polls SmolVM capacity and metrics, stores samples via the
 * manager store, and prunes old data using existing retention conventions.
 *
 * The sampler is designed to be called periodically (e.g. every 30 seconds)
 * from a server-side timer or on-demand from API routes.
 */

import { getSmolVmClient, type SmolVmClient } from '$lib/server/smolvm-client';
import {
  getManagerStoreClient,
  createServiceAuthContext,
  type ManagerStoreClient,
  type MetricsSample
} from '$lib/server/manager-store-client';
import { parsePrometheusText, parseCapacityResponse, extractSmolVmSummary } from './metrics-parser';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default sampling interval in milliseconds. */
export const DEFAULT_SAMPLE_INTERVAL_MS = 30_000;

/** Default retention: keep at most this many global samples. */
export const DEFAULT_MAX_GLOBAL_SAMPLES = 2880; // ~24h at 30s intervals

/** Default retention: keep at most this many per-machine samples. */
export const DEFAULT_MAX_MACHINE_SAMPLES = 2880;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MetricsSnapshot = {
  capacity: {
    allocatedCpus: number;
    allocatedMemoryMb: number;
    usedCpus: number;
    usedMemoryMb: number;
    usedDiskGb: number;
  };
  summary: {
    machinesRunning: number | null;
    machinesTotal: number | null;
    perVmUnavailable: boolean;
  };
  sampledAt: string;
};

// ---------------------------------------------------------------------------
// Sampler
// ---------------------------------------------------------------------------

/**
 * Collect a single metrics snapshot from SmolVM and store it.
 *
 * Returns the stored sample or null if SmolVM is unreachable.
 * Prunes old samples after insertion to keep retention bounded.
 */
export async function collectAndStoreSample(options?: {
  client?: SmolVmClient;
  store?: ManagerStoreClient;
  maxGlobalSamples?: number;
}): Promise<MetricsSample | null> {
  const client = options?.client ?? getSmolVmClient();
  const store = options?.store ?? getManagerStoreClient();
  const maxGlobal = options?.maxGlobalSamples ?? DEFAULT_MAX_GLOBAL_SAMPLES;

  try {
    const [capacityRaw] = await Promise.all([client.getCapacity(), client.getMetrics()]);

    const capacity = parseCapacityResponse(capacityRaw);
    if (!capacity) return null;

    const serviceAuth = createServiceAuthContext();
    const sample = await store.insertMetricsSample(
      {
        machineName: undefined, // global sample
        cpu: capacity.usedCpus,
        memoryMb: capacity.usedMemoryMb,
        diskGb: capacity.usedDiskGb,
        networkRxBytes: 0, // SmolVM metrics don't expose per-VM network yet
        networkTxBytes: 0
      },
      serviceAuth ?? undefined
    );

    // Prune old global samples in the background (don't await to keep latency low)
    store.pruneMetricsSamples(undefined, maxGlobal, serviceAuth ?? undefined).catch(() => {
      // Pruning failure is non-critical; log and continue
    });

    return sample;
  } catch {
    // SmolVM unreachable or error — skip this sample
    return null;
  }
}

/**
 * Build a MetricsSnapshot from live SmolVM data without storing it.
 * Used for on-demand API responses.
 */
export async function getLiveSnapshot(options?: {
  client?: SmolVmClient;
}): Promise<MetricsSnapshot | null> {
  const client = options?.client ?? getSmolVmClient();

  try {
    const [capacityRaw, metricsText] = await Promise.all([
      client.getCapacity(),
      client.getMetrics()
    ]);

    const capacity = parseCapacityResponse(capacityRaw);
    if (!capacity) return null;

    const parsed = parsePrometheusText(metricsText);
    const summary = extractSmolVmSummary(parsed);

    return {
      capacity: {
        allocatedCpus: capacity.allocatedCpus,
        allocatedMemoryMb: capacity.allocatedMemoryMb,
        usedCpus: capacity.usedCpus,
        usedMemoryMb: capacity.usedMemoryMb,
        usedDiskGb: capacity.usedDiskGb
      },
      summary: {
        machinesRunning: summary.machinesRunning,
        machinesTotal: summary.machinesTotal,
        perVmUnavailable: summary.perVmUnavailable
      },
      sampledAt: new Date().toISOString()
    };
  } catch {
    return null;
  }
}

const samplerGuard = globalThis as { __smolvmMetricsSamplerStarted?: boolean };

export function startMetricsSampler(intervalMs: number = DEFAULT_SAMPLE_INTERVAL_MS): void {
  if (samplerGuard.__smolvmMetricsSamplerStarted) return;
  samplerGuard.__smolvmMetricsSamplerStarted = true;
  const tick = () => void collectAndStoreSample();
  void collectAndStoreSample();
  setInterval(tick, intervalMs).unref();
}

/**
 * Retrieve recent metrics history from the store.
 */
export async function getMetricsHistory(options?: {
  store?: ManagerStoreClient;
  machineName?: string;
  limit?: number;
}): Promise<MetricsSample[]> {
  const store = options?.store ?? getManagerStoreClient();
  return store.listMetricsSamples(options?.machineName, options?.limit);
}
