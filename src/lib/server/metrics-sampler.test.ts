import { describe, expect, test, beforeEach } from 'bun:test';
import { collectAndStoreSample, getLiveSnapshot } from './metrics-sampler';
import {
  createMockManagerStoreClient,
  resetMockManagerStore,
  type ManagerStoreClient
} from './manager-store-client';
import type { SmolVmClient } from './smolvm-client';

// ---------------------------------------------------------------------------
// Mock SmolVM client
// ---------------------------------------------------------------------------

const MOCK_CAPACITY = {
  allocated_cpus: 4,
  allocated_memory_mb: 8192,
  used_cpus: 2.5,
  used_memory_mb: 4096,
  used_disk_gb: 50
};

const MOCK_METRICS_TEXT = [
  '# TYPE smolvm_api_requests_total counter',
  'smolvm_api_requests_total{method="GET",status="200",path="/health"} 42',
  '# TYPE smolvm_machines_running gauge',
  'smolvm_machines_running 2',
  '# TYPE smolvm_machines_total gauge',
  'smolvm_machines_total 5'
].join('\n');

function createMockSmolVmClient(
  capacity: unknown = MOCK_CAPACITY,
  metrics: string = MOCK_METRICS_TEXT
): SmolVmClient {
  return {
    socketPath: '/tmp/test.sock',
    getHealth: async () => ({ status: 'ok', version: '0.8.1' }),
    getCapacity: async () => capacity as Record<string, unknown>,
    getMetrics: async () => metrics,
    listMachines: async () => ({ machines: [] }),
    getMachine: async () => ({ name: 'test' }),
    createMachine: async () => ({ name: 'test' }),
    startMachine: async () => null,
    stopMachine: async () => null,
    deleteMachine: async () => null,
    openLogStream: async () => {
      throw new Error('not implemented');
    },
  execMachine: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  downloadMachineFile: async () => ({ path: '/tmp/file', content: '', encoding: 'utf-8' as const }),
  listMachineImages: async () => ({ machine: 'vm', images: [] }),
  pullMachineImage: async () => ({
    machine: 'vm',
    image: {
      reference: 'alpine:latest',
      digest: 'sha256:abc',
      size: 0,
      architecture: 'amd64',
      os: 'linux',
      layerCount: 0
    }
  })
};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('collectAndStoreSample', () => {
  let store: ManagerStoreClient;

  beforeEach(() => {
    resetMockManagerStore();
    store = createMockManagerStoreClient();
  });

  test('collects capacity and stores a global sample', async () => {
    const client = createMockSmolVmClient();
    const sample = await collectAndStoreSample({ client, store });

    expect(sample).not.toBeNull();
    expect(sample!.cpu).toBe(2.5);
    expect(sample!.memoryMb).toBe(4096);
    expect(sample!.diskGb).toBe(50);
    expect(sample!.machineName).toBeNull();
  });

  test('returns null when SmolVM is unreachable', async () => {
    const unreachableClient: SmolVmClient = {
      ...createMockSmolVmClient(),
      getCapacity: async () => {
        throw new Error('SmolVM is unreachable');
      }
    };

    const sample = await collectAndStoreSample({ client: unreachableClient, store });
    expect(sample).toBeNull();
  });

  test('returns null when capacity response is invalid', async () => {
    const badClient = createMockSmolVmClient(null);
    const sample = await collectAndStoreSample({ client: badClient, store });
    expect(sample).toBeNull();
  });

  test('prunes samples after insertion', async () => {
    const client = createMockSmolVmClient();
    // Insert more than maxGlobal samples
    for (let i = 0; i < 5; i++) {
      await collectAndStoreSample({ client, store, maxGlobalSamples: 3 });
    }
    // Allow pruning to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    const samples = await store.listMetricsSamples();
    expect(samples.length).toBeLessThanOrEqual(3);
  });
});

describe('getLiveSnapshot', () => {
  test('returns capacity and summary from live SmolVM', async () => {
    const client = createMockSmolVmClient();
    const snapshot = await getLiveSnapshot({ client });

    expect(snapshot).not.toBeNull();
    expect(snapshot!.capacity.allocatedCpus).toBe(4);
    expect(snapshot!.capacity.usedCpus).toBe(2.5);
    expect(snapshot!.capacity.usedMemoryMb).toBe(4096);
    expect(snapshot!.capacity.usedDiskGb).toBe(50);
    expect(snapshot!.summary.machinesRunning).toBe(2);
    expect(snapshot!.summary.machinesTotal).toBe(5);
    expect(snapshot!.summary.perVmUnavailable).toBe(true);
  });

  test('returns null when SmolVM is unreachable', async () => {
    const unreachableClient: SmolVmClient = {
      ...createMockSmolVmClient(),
      getCapacity: async () => {
        throw new Error('SmolVM is unreachable');
      }
    };

    const snapshot = await getLiveSnapshot({ client: unreachableClient });
    expect(snapshot).toBeNull();
  });

  test('detects per-VM labels when present', async () => {
    const metricsWithVm = 'smolvm_cpu_percent{machine="vm-1"} 45.2\nsmolvm_machines_running 1\n';
    const client = createMockSmolVmClient(MOCK_CAPACITY, metricsWithVm);
    const snapshot = await getLiveSnapshot({ client });

    expect(snapshot!.summary.perVmUnavailable).toBe(false);
  });
});
