import {
  getSmolVmClient,
  normalizeSmolVmError,
  type SmolVmClient,
  type SmolVmStreamResponse
} from '$lib/server/smolvm-client';
import { sseEncode } from '$lib/server/smolvm-streaming';

export const MAX_GLOBAL_STREAMS = 8;
const DEFAULT_GLOBAL_TAIL = 100;
const MAX_GLOBAL_TAIL = 1000;
const MACHINE_QUEUE_SIZE = 200;
const MACHINE_POLL_MS = 10_000;
const UNEXPECTED_ERROR_MESSAGE = 'SmolVM returned an unexpected response.';

type GlobalLogsContext = {
  readonly locals: App.Locals;
  readonly request: Request;
  readonly url: URL;
  readonly client?: SmolVmClient;
};

type MachineStream = {
  readonly abort: AbortController;
  readonly upstream: SmolVmStreamResponse;
  readonly queue: string[];
  dropped: number;
};

function parseTail(value: string | null): number {
  if (!value) return DEFAULT_GLOBAL_TAIL;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_GLOBAL_TAIL;
  return Math.min(Math.floor(parsed), MAX_GLOBAL_TAIL);
}

export async function createGlobalLogsSseResponse(context: GlobalLogsContext): Promise<Response> {
  if (!context.locals.admin) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const client = context.client ?? getSmolVmClient();
  const tail = parseTail(context.url.searchParams.get('tail'));
  let initialMachines: string[] = [];
  let initialError: string | undefined;
  try {
    const result = await client.listMachines();
    initialMachines = [...new Set(result.machines.map((machine) => machine.name))];
  } catch (error) {
    initialError =
      error instanceof Error ? normalizeSmolVmError(error).message : UNEXPECTED_ERROR_MESSAGE;
  }

  const encoder = new TextEncoder();
  const desired = new Set(initialMachines);
  const active = new Map<string, MachineStream>();
  const pending = new Map<string, AbortController>();
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let flushScheduled = false;
  let polling = false;
  let closed = false;

  const emit = (event: string, data: unknown) => {
    if (!closed) controller?.enqueue(encoder.encode(sseEncode(event, data)));
  };

  const flush = () => {
    flushScheduled = false;
    if (closed) return;
    for (const [machine, state] of active) {
      if (state.dropped > 0) {
        emit('gap', { machine, dropped: state.dropped });
        state.dropped = 0;
      }
      for (const line of state.queue.splice(0)) emit('log', { machine, line });
    }
  };

  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;
    queueMicrotask(flush);
  };

  const queueLines = (state: MachineStream, lines: readonly string[]) => {
    for (const line of lines) {
      if (line.length === 0) continue;
      if (state.queue.length === MACHINE_QUEUE_SIZE) {
        state.queue.shift();
        state.dropped += 1;
      }
      state.queue.push(line);
    }
    scheduleFlush();
  };

  const consume = async (machine: string, state: MachineStream) => {
    const decoder = new TextDecoder();
    let buffered = '';
    try {
      for await (const chunk of state.upstream.stream) {
        buffered += decoder.decode(chunk, { stream: true });
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? '';
        queueLines(state, lines);
      }
      buffered += decoder.decode();
      if (buffered.length > 0) queueLines(state, [buffered]);
      if (!closed && !state.abort.signal.aborted) {
        emit('machine', { name: machine, state: 'offline' });
        emit('error', { machine, message: 'Log stream disconnected.' });
      }
    } catch (error) {
      if (!closed && !state.abort.signal.aborted) {
        const message =
          error instanceof Error ? normalizeSmolVmError(error).message : UNEXPECTED_ERROR_MESSAGE;
        emit('machine', { name: machine, state: 'offline' });
        emit('error', { machine, message });
      }
    } finally {
      if (active.get(machine) === state) active.delete(machine);
      state.upstream.close();
    }
  };

  const open = async (machine: string, abort: AbortController) => {
    try {
      const upstream = await client.openLogStream(machine, {
        tail,
        follow: true,
        signal: abort.signal
      });
      if (closed || abort.signal.aborted || !desired.has(machine)) {
        upstream.close();
        return;
      }
      const state: MachineStream = { abort, upstream, queue: [], dropped: 0 };
      active.set(machine, state);
      void consume(machine, state);
    } catch (error) {
      if (!closed && !abort.signal.aborted) {
        const message =
          error instanceof Error ? normalizeSmolVmError(error).message : UNEXPECTED_ERROR_MESSAGE;
        emit('machine', { name: machine, state: 'offline' });
        emit('error', { machine, message });
      }
    } finally {
      pending.delete(machine);
    }
  };

  const fillSlots = () => {
    for (const machine of desired) {
      if (active.size + pending.size >= MAX_GLOBAL_STREAMS) break;
      if (active.has(machine) || pending.has(machine)) continue;
      const abort = new AbortController();
      pending.set(machine, abort);
      void open(machine, abort);
    }
  };

  const reconcile = (machines: readonly string[]) => {
    const next = new Set(machines);
    for (const machine of desired) {
      if (next.has(machine)) continue;
      desired.delete(machine);
      const state = active.get(machine);
      if (state) {
        active.delete(machine);
        state.abort.abort();
        state.upstream.close();
      }
      pending.get(machine)?.abort();
      emit('machine', { name: machine, state: 'removed' });
    }
    for (const machine of next) {
      if (desired.has(machine)) continue;
      desired.add(machine);
      emit('machine', { name: machine, state: 'added' });
    }
    fillSlots();
  };

  const poll = async () => {
    if (closed || polling) return;
    polling = true;
    try {
      const result = await client.listMachines();
      reconcile([...new Set(result.machines.map((machine) => machine.name))]);
    } catch (error) {
      const message =
        error instanceof Error ? normalizeSmolVmError(error).message : UNEXPECTED_ERROR_MESSAGE;
      emit('error', { message });
    } finally {
      polling = false;
    }
  };

  const cleanup = () => {
    if (closed) return;
    closed = true;
    if (interval) clearInterval(interval);
    for (const abort of pending.values()) abort.abort();
    pending.clear();
    for (const state of active.values()) {
      state.abort.abort();
      state.upstream.close();
    }
    active.clear();
  };

  const stream = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      emit('ready', { machines: initialMachines });
      if (initialError) emit('error', { message: initialError });
      fillSlots();
      interval = setInterval(() => void poll(), MACHINE_POLL_MS);
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
