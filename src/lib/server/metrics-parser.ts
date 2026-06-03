/**
 * Prometheus text format parser for SmolVM metrics.
 *
 * Parses conservatively: unknown metric names, malformed lines, and missing
 * labels are silently skipped. When per-VM labels (e.g. `machine`) are absent
 * from relevant metrics, the result surfaces `perVmUnavailable: true` so the
 * UI can display a truthful "per-VM metrics unavailable" state instead of
 * fabricating data.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ParsedMetric = {
  name: string;
  labels: Record<string, string>;
  value: number;
  timestamp?: number;
};

export type ParsedMetrics = {
  metrics: ParsedMetric[];
  perVmUnavailable: boolean;
};

export type CapacityData = {
  allocatedCpus: number;
  allocatedMemoryMb: number;
  usedCpus: number;
  usedMemoryMb: number;
  usedDiskGb: number;
};

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const LINE_REGEX =
  /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{([^}]*)\})?\s+([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*(\d+)?$/;

const LABEL_PAIR_REGEX = /^([a-zA-Z_][a-zA-Z0-9_]*)=(?:"([^"]*)"|([a-zA-Z0-9_.-]+))$/;

/**
 * Parse a Prometheus text exposition into structured metric entries.
 *
 * - TYPE/HELP comment lines are skipped.
 * - Lines that do not match the expected format are silently ignored.
 * - If no metric carries a `machine` label, `perVmUnavailable` is set to true.
 */
export function parsePrometheusText(text: string): ParsedMetrics {
  const metrics: ParsedMetric[] = [];
  let hasMachineLabel = false;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const match = LINE_REGEX.exec(line);
    if (!match) continue;

    const name = match[1];
    const labelsRaw = match[2] ?? '';
    const valueStr = match[3];
    const timestampStr = match[4];

    const labels = parseLabels(labelsRaw);
    if (labels === null) continue; // malformed label section

    if ('machine' in labels) {
      hasMachineLabel = true;
    }

    const value = Number(valueStr);
    if (!Number.isFinite(value)) continue;

    const metric: ParsedMetric = { name, labels, value };
    if (timestampStr !== undefined) {
      metric.timestamp = Number(timestampStr);
    }

    metrics.push(metric);
  }

  return {
    metrics,
    perVmUnavailable: !hasMachineLabel
  };
}

/**
 * Parse label pairs from the `{key="val",key2=val2}` portion of a metric line.
 * Returns null if any individual pair is malformed (conservative: skip the line).
 */
function parseLabels(raw: string): Record<string, string> | null {
  if (raw === '') return {};

  const labels: Record<string, string> = {};
  const pairs = splitLabelPairs(raw);

  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (trimmed === '') continue;

    const match = LABEL_PAIR_REGEX.exec(trimmed);
    if (!match) return null; // malformed label pair → skip entire line

    const key = match[1];
    const value = match[2] ?? match[3] ?? '';
    labels[key] = value;
  }

  return labels;
}

/**
 * Split a label string on commas, respecting quoted strings.
 */
function splitLabelPairs(raw: string): string[] {
  const pairs: string[] = [];
  let current = '';
  let inQuotes = false;

  for (const ch of raw) {
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === ',' && !inQuotes) {
      pairs.push(current);
      current = '';
    } else {
      current += ch;
    }
  }

  if (current !== '') pairs.push(current);
  return pairs;
}

// ---------------------------------------------------------------------------
// Capacity parser
// ---------------------------------------------------------------------------

/**
 * Parse the SmolVM `/capacity` JSON response into a typed object.
 * Returns null if the response shape is invalid.
 */
export function parseCapacityResponse(body: unknown): CapacityData | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  const obj = body as Record<string, unknown>;

  const allocatedCpus = Number(obj.allocated_cpus ?? obj.allocatedCpus ?? 0);
  const allocatedMemoryMb = Number(obj.allocated_memory_mb ?? obj.allocatedMemoryMb ?? 0);
  const usedCpus = Number(obj.used_cpus ?? obj.usedCpus ?? 0);
  const usedMemoryMb = Number(obj.used_memory_mb ?? obj.usedMemoryMb ?? 0);
  const usedDiskGb = Number(obj.used_disk_gb ?? obj.usedDiskGb ?? 0);

  if (
    !Number.isFinite(allocatedCpus) ||
    !Number.isFinite(allocatedMemoryMb) ||
    !Number.isFinite(usedCpus) ||
    !Number.isFinite(usedMemoryMb) ||
    !Number.isFinite(usedDiskGb)
  ) {
    return null;
  }

  return {
    allocatedCpus,
    allocatedMemoryMb,
    usedCpus,
    usedMemoryMb,
    usedDiskGb
  };
}

// ---------------------------------------------------------------------------
// Convenience: extract well-known SmolVM metrics
// ---------------------------------------------------------------------------

export type SmolVmMetricSummary = {
  machinesRunning: number | null;
  machinesTotal: number | null;
  apiRequestsTotal: Array<{ method: string; status: string; path: string; count: number }>;
  perVmUnavailable: boolean;
  rawMetrics: ParsedMetric[];
};

/**
 * Extract well-known SmolVM metric values from a parsed result.
 * Returns null for any metric that is not present.
 */
export function extractSmolVmSummary(parsed: ParsedMetrics): SmolVmMetricSummary {
  const running = parsed.metrics.find((m) => m.name === 'smolvm_machines_running');
  const total = parsed.metrics.find((m) => m.name === 'smolvm_machines_total');

  const apiRequests = parsed.metrics
    .filter((m) => m.name === 'smolvm_api_requests_total')
    .map((m) => ({
      method: m.labels.method ?? '',
      status: m.labels.status ?? '',
      path: m.labels.path ?? '',
      count: m.value
    }));

  return {
    machinesRunning: running ? running.value : null,
    machinesTotal: total ? total.value : null,
    apiRequestsTotal: apiRequests,
    perVmUnavailable: parsed.perVmUnavailable,
    rawMetrics: parsed.metrics
  };
}
