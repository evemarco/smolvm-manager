import { describe, expect, test } from 'bun:test';
import { parsePrometheusText, parseCapacityResponse, extractSmolVmSummary } from './metrics-parser';

// ---------------------------------------------------------------------------
// Prometheus text parser
// ---------------------------------------------------------------------------

describe('parsePrometheusText', () => {
  test('parses simple gauge without labels', () => {
    const result = parsePrometheusText('smolvm_machines_running 0\n');
    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0].name).toBe('smolvm_machines_running');
    expect(result.metrics[0].value).toBe(0);
    expect(result.metrics[0].labels).toEqual({});
    expect(result.perVmUnavailable).toBe(true);
  });

  test('parses counter with labels', () => {
    const text =
      'smolvm_api_requests_total{method="GET",status="200",path="/api/v1/machines"} 262\n';
    const result = parsePrometheusText(text);
    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0].name).toBe('smolvm_api_requests_total');
    expect(result.metrics[0].value).toBe(262);
    expect(result.metrics[0].labels).toEqual({
      method: 'GET',
      status: '200',
      path: '/api/v1/machines'
    });
    expect(result.perVmUnavailable).toBe(true);
  });

  test('parses multiple metrics', () => {
    const text = [
      '# TYPE smolvm_machines_running gauge',
      'smolvm_machines_running 2',
      '# TYPE smolvm_machines_total gauge',
      'smolvm_machines_total 3',
      '# TYPE smolvm_api_requests_total counter',
      'smolvm_api_requests_total{method="GET",status="200",path="/health"} 42'
    ].join('\n');
    const result = parsePrometheusText(text);
    expect(result.metrics).toHaveLength(3);
    expect(result.metrics[0].value).toBe(2);
    expect(result.metrics[1].value).toBe(3);
    expect(result.metrics[2].value).toBe(42);
  });

  test('detects per-VM labels when present', () => {
    const text = 'smolvm_cpu_percent{machine="vm-1"} 45.2\n';
    const result = parsePrometheusText(text);
    expect(result.perVmUnavailable).toBe(false);
    expect(result.metrics[0].labels.machine).toBe('vm-1');
  });

  test('sets perVmUnavailable when no machine labels exist', () => {
    const text = 'smolvm_machines_running 0\nsmolvm_machines_total 1\n';
    const result = parsePrometheusText(text);
    expect(result.perVmUnavailable).toBe(true);
  });

  test('handles float values', () => {
    const text = 'smolvm_used_cpus 2.5\n';
    const result = parsePrometheusText(text);
    expect(result.metrics[0].value).toBe(2.5);
  });

  test('handles scientific notation values', () => {
    const text = 'smolvm_bytes 1.5e6\n';
    const result = parsePrometheusText(text);
    expect(result.metrics[0].value).toBe(1_500_000);
  });

  test('handles negative values', () => {
    const text = 'smolvm_delta -42\n';
    const result = parsePrometheusText(text);
    expect(result.metrics[0].value).toBe(-42);
  });

  test('handles timestamp in metric line', () => {
    const text = 'smolvm_machines_running 0 1609459200\n';
    const result = parsePrometheusText(text);
    expect(result.metrics[0].timestamp).toBe(1609459200);
  });

  test('skips comment lines', () => {
    const text =
      '# TYPE smolvm_machines_running gauge\n# HELP some help text\nsmolvm_machines_running 1\n';
    const result = parsePrometheusText(text);
    expect(result.metrics).toHaveLength(1);
  });

  test('skips empty lines', () => {
    const text = '\n\nsmolvm_machines_running 1\n\n';
    const result = parsePrometheusText(text);
    expect(result.metrics).toHaveLength(1);
  });

  test('skips malformed lines', () => {
    const text = 'not a metric line\nsmolvm_machines_running 1\n';
    const result = parsePrometheusText(text);
    expect(result.metrics).toHaveLength(1);
  });

  test('skips lines with malformed labels', () => {
    const text = 'smolvm_metric{bad label} 1\nsmolvm_machines_running 2\n';
    const result = parsePrometheusText(text);
    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0].value).toBe(2);
  });

  test('handles empty input', () => {
    const result = parsePrometheusText('');
    expect(result.metrics).toHaveLength(0);
    expect(result.perVmUnavailable).toBe(true);
  });

  test('handles unquoted label values alongside quoted values', () => {
    const text = 'smolvm_metric{status="200",method=GET} 5\nsmolvm_machines_running 2\n';
    const result = parsePrometheusText(text);
    expect(result.metrics).toHaveLength(2);
    expect(result.metrics[0].labels.method).toBe('GET');
    expect(result.metrics[0].labels.status).toBe('200');
  });

  test('handles labels with commas inside quoted values', () => {
    const text = 'smolvm_metric{path="/api/v1/machines,other"} 10\n';
    const result = parsePrometheusText(text);
    expect(result.metrics).toHaveLength(1);
    expect(result.metrics[0].labels.path).toBe('/api/v1/machines,other');
  });
});

// ---------------------------------------------------------------------------
// Capacity parser
// ---------------------------------------------------------------------------

describe('parseCapacityResponse', () => {
  test('parses valid capacity response', () => {
    const body = {
      allocated_cpus: 4,
      allocated_memory_mb: 8192,
      used_cpus: 2.5,
      used_memory_mb: 4096,
      used_disk_gb: 50
    };
    const result = parseCapacityResponse(body);
    expect(result).toEqual({
      allocatedCpus: 4,
      allocatedMemoryMb: 8192,
      usedCpus: 2.5,
      usedMemoryMb: 4096,
      usedDiskGb: 50
    });
  });

  test('parses camelCase capacity response', () => {
    const body = {
      allocatedCpus: 2,
      allocatedMemoryMb: 4096,
      usedCpus: 1.0,
      usedMemoryMb: 2048,
      usedDiskGb: 25
    };
    const result = parseCapacityResponse(body);
    expect(result).toEqual({
      allocatedCpus: 2,
      allocatedMemoryMb: 4096,
      usedCpus: 1.0,
      usedMemoryMb: 2048,
      usedDiskGb: 25
    });
  });

  test('defaults missing fields to 0', () => {
    const body = {};
    const result = parseCapacityResponse(body);
    expect(result).toEqual({
      allocatedCpus: 0,
      allocatedMemoryMb: 0,
      usedCpus: 0,
      usedMemoryMb: 0,
      usedDiskGb: 0
    });
  });

  test('returns null for null input', () => {
    expect(parseCapacityResponse(null)).toBeNull();
  });

  test('returns null for array input', () => {
    expect(parseCapacityResponse([1, 2, 3])).toBeNull();
  });

  test('returns null for string input', () => {
    expect(parseCapacityResponse('not an object')).toBeNull();
  });

  test('returns null for NaN numeric fields', () => {
    const body = {
      allocated_cpus: 4,
      allocated_memory_mb: 8192,
      used_cpus: NaN,
      used_memory_mb: 4096,
      used_disk_gb: 50
    };
    expect(parseCapacityResponse(body)).toBeNull();
  });

  test('returns null for Infinity numeric fields', () => {
    const body = {
      allocated_cpus: 4,
      allocated_memory_mb: Infinity,
      used_cpus: 2.5,
      used_memory_mb: 4096,
      used_disk_gb: 50
    };
    expect(parseCapacityResponse(body)).toBeNull();
  });

  test('returns null for -Infinity numeric fields', () => {
    const body = {
      allocated_cpus: 4,
      allocated_memory_mb: 8192,
      used_cpus: 2.5,
      used_memory_mb: 4096,
      used_disk_gb: -Infinity
    };
    expect(parseCapacityResponse(body)).toBeNull();
  });

  test('returns null for string fields that coerce to NaN', () => {
    const body = {
      allocated_cpus: 4,
      allocated_memory_mb: 'not-a-number',
      used_cpus: 2.5,
      used_memory_mb: 4096,
      used_disk_gb: 50
    };
    expect(parseCapacityResponse(body)).toBeNull();
  });

  test('accepts valid zero values', () => {
    const body = {
      allocated_cpus: 0,
      allocated_memory_mb: 0,
      used_cpus: 0,
      used_memory_mb: 0,
      used_disk_gb: 0
    };
    expect(parseCapacityResponse(body)).toEqual({
      allocatedCpus: 0,
      allocatedMemoryMb: 0,
      usedCpus: 0,
      usedMemoryMb: 0,
      usedDiskGb: 0
    });
  });
});

// ---------------------------------------------------------------------------
// SmolVM summary extraction
// ---------------------------------------------------------------------------

describe('extractSmolVmSummary', () => {
  test('extracts running and total counts', () => {
    const text = ['smolvm_machines_running 2', 'smolvm_machines_total 5'].join('\n');
    const parsed = parsePrometheusText(text);
    const summary = extractSmolVmSummary(parsed);
    expect(summary.machinesRunning).toBe(2);
    expect(summary.machinesTotal).toBe(5);
    expect(summary.perVmUnavailable).toBe(true);
  });

  test('returns null for missing metrics', () => {
    const text = 'smolvm_other_metric 42\n';
    const parsed = parsePrometheusText(text);
    const summary = extractSmolVmSummary(parsed);
    expect(summary.machinesRunning).toBeNull();
    expect(summary.machinesTotal).toBeNull();
  });

  test('extracts API request counters', () => {
    const text = [
      'smolvm_api_requests_total{method="GET",status="200",path="/health"} 42',
      'smolvm_api_requests_total{method="POST",status="200",path="/api/v1/machines"} 6'
    ].join('\n');
    const parsed = parsePrometheusText(text);
    const summary = extractSmolVmSummary(parsed);
    expect(summary.apiRequestsTotal).toHaveLength(2);
    expect(summary.apiRequestsTotal[0].method).toBe('GET');
    expect(summary.apiRequestsTotal[0].count).toBe(42);
    expect(summary.apiRequestsTotal[1].method).toBe('POST');
  });

  test('detects per-VM availability', () => {
    const text = 'smolvm_cpu_percent{machine="vm-1"} 45.2\n';
    const parsed = parsePrometheusText(text);
    const summary = extractSmolVmSummary(parsed);
    expect(summary.perVmUnavailable).toBe(false);
  });
});
