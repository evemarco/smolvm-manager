import {
  getSmolVmClient,
  normalizeSmolVmError,
  type SmolVmClient
} from '$lib/server/smolvm-client';
import { sseEncode } from '$lib/server/smolvm-streaming';

export const MACHINE_STREAM_POLL_MS = 1_000;
const UNEXPECTED_ERROR_MESSAGE = 'SmolVM returned an unexpected response.';

type MachineStreamContext = {
  readonly locals: App.Locals;
  readonly request: Request;
  readonly client?: SmolVmClient;
  readonly pollMs?: number;
};

export type MachineStreamSnapshot = {
  readonly machines: unknown;
  readonly capacity: unknown;
};

type Subscriber = {
  readonly emit: (event: string, data: unknown) => void;
};

export type MachineStreamBroadcaster = {
  readonly subscribe: (subscriber: Subscriber) => () => void;
  readonly stop: () => void;
};

export function createMachineStreamBroadcaster(
  client: SmolVmClient,
  options: { pollMs?: number } = {}
): MachineStreamBroadcaster {
  const pollMs = options.pollMs ?? MACHINE_STREAM_POLL_MS;
  const subscribers = new Set<Subscriber>();
  let interval: ReturnType<typeof setInterval> | undefined;
  let polling = false;
  let stopped = false;
  let lastJson: string | null = null;
  let lastSnapshot: MachineStreamSnapshot | null = null;
  let lastError: string | null = null;

  const broadcast = (event: string, data: unknown) => {
    for (const subscriber of subscribers) subscriber.emit(event, data);
  };

  const poll = async () => {
    if (stopped || polling) return;
    polling = true;
    try {
      const [machineList, capacity] = await Promise.all([
        client.listMachines(),
        client.getCapacity()
      ]);
      const snapshot: MachineStreamSnapshot = { machines: machineList.machines, capacity };
      const json = JSON.stringify(snapshot);
      if (json !== lastJson) {
        lastJson = json;
        lastSnapshot = snapshot;
        broadcast('snapshot', snapshot);
      }
      if (lastError) {
        lastError = null;
        broadcast('recovered', {});
      }
    } catch (error) {
      const message =
        error instanceof Error ? normalizeSmolVmError(error).message : UNEXPECTED_ERROR_MESSAGE;
      if (message !== lastError) {
        lastError = message;
        broadcast('stream-error', { message });
      }
    } finally {
      polling = false;
    }
  };

  return {
    subscribe(subscriber) {
      if (stopped) return () => undefined;
      subscribers.add(subscriber);
      subscriber.emit('ready', { pollMs });
      if (lastSnapshot) subscriber.emit('snapshot', lastSnapshot);
      if (lastError) subscriber.emit('stream-error', { message: lastError });
      if (subscribers.size === 1) {
        void poll();
        interval = setInterval(() => void poll(), pollMs);
      }
      return () => {
        subscribers.delete(subscriber);
        if (subscribers.size === 0 && interval) {
          clearInterval(interval);
          interval = undefined;
        }
      };
    },
    stop() {
      stopped = true;
      if (interval) clearInterval(interval);
      interval = undefined;
      subscribers.clear();
    }
  };
}

let shared: { client: SmolVmClient; broadcaster: MachineStreamBroadcaster } | null = null;

function getSharedBroadcaster(client: SmolVmClient, pollMs?: number): MachineStreamBroadcaster {
  if (!shared || shared.client !== client) {
    shared?.broadcaster.stop();
    shared = { client, broadcaster: createMachineStreamBroadcaster(client, { pollMs }) };
  }
  return shared.broadcaster;
}

export function __resetMachineStreamForTests(): void {
  shared?.broadcaster.stop();
  shared = null;
}

export async function createMachineStreamSseResponse(
  context: MachineStreamContext
): Promise<Response> {
  if (!context.locals.admin) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const broadcaster = getSharedBroadcaster(context.client ?? getSmolVmClient(), context.pollMs);
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | undefined;

  const cleanup = () => {
    unsubscribe?.();
    unsubscribe = undefined;
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      unsubscribe = broadcaster.subscribe({
        emit(event, data) {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(sseEncode(event, data)));
          } catch {
            closed = true;
            cleanup();
          }
        }
      });
      if (context.request.signal.aborted) cleanup();
      else context.request.signal.addEventListener('abort', cleanup, { once: true });
    },
    cancel: cleanup
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
