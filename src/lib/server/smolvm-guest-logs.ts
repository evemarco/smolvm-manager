import {
  getSmolVmClient,
  normalizeSmolVmError,
  type SmolVmClient,
  type SmolVmExecRequest,
  type SmolVmStreamResponse
} from '$lib/server/smolvm-client';
import { sseEncode } from '$lib/server/smolvm-streaming';

const DEFAULT_TAIL = 200;
const MAX_TAIL = 1000;

type GuestLogsContext = {
  readonly locals: App.Locals;
  readonly request: Request;
  readonly url: URL;
  readonly params: { readonly name: string };
  readonly client?: SmolVmClient;
};

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function parseTail(value: string | null): number {
  if (!value) return DEFAULT_TAIL;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_TAIL;
  return Math.min(Math.floor(parsed), MAX_TAIL);
}

function buildCommand(url: URL, tail: number): string[] | Response {
  const source = url.searchParams.get('source') ?? 'journalctl';
  if (source === 'journalctl') {
    return ['journalctl', '-f', '-n', String(tail), '--no-pager'];
  }
  if (source !== 'file') return jsonError('Invalid guest log source.', 400);

  const path = url.searchParams.get('path');
  if (
    !path ||
    !path.startsWith('/var/log/') ||
    path.includes('\0') ||
    path.split('/').some((segment) => segment === '..')
  ) {
    return jsonError('Guest log path must be strictly under /var/log/.', 400);
  }
  return ['tail', '-n', String(tail), '-F', path];
}

function encodeExecEvent(frame: string): string | undefined {
  let event = '';
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trimStart();
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  const payload = data.join('\n');

  if (event === 'stdout' || event === 'stderr') {
    return sseEncode('line', { stream: event, text: payload });
  }
  if (event === 'exit') {
    const value: unknown = JSON.parse(payload);
    if (value && typeof value === 'object' && 'exitCode' in value) {
      const code = value.exitCode;
      if (typeof code === 'number') return sseEncode('exit', { code });
    }
  }
  if (event === 'error') {
    const value: unknown = JSON.parse(payload);
    if (value && typeof value === 'object' && 'message' in value) {
      const message = value.message;
      if (typeof message === 'string') return sseEncode('error', { message });
    }
  }
  return undefined;
}

async function pipeExecStream(
  controller: ReadableStreamDefaultController<Uint8Array>,
  upstream: SmolVmStreamResponse,
  isClosed: () => boolean,
  cleanup: () => void
): Promise<void> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let buffered = '';
  try {
    for await (const chunk of upstream.stream) {
      buffered += decoder.decode(chunk, { stream: true });
      const frames = buffered.split(/\r?\n\r?\n/);
      buffered = frames.pop() ?? '';
      for (const frame of frames) {
        const encoded = encodeExecEvent(frame);
        if (encoded && !isClosed()) controller.enqueue(encoder.encode(encoded));
      }
    }
    buffered += decoder.decode();
    if (buffered.trim() && !isClosed()) {
      const encoded = encodeExecEvent(buffered);
      if (encoded) controller.enqueue(encoder.encode(encoded));
    }
  } catch (error) {
    if (!isClosed()) {
      const message =
        error instanceof Error
          ? normalizeSmolVmError(error).message
          : 'SmolVM returned an unexpected response.';
      controller.enqueue(encoder.encode(sseEncode('error', { message })));
    }
  } finally {
    const shouldClose = !isClosed();
    cleanup();
    if (shouldClose) controller.close();
  }
}

export async function createGuestLogsSseResponse(context: GuestLogsContext): Promise<Response> {
  if (!context.locals.admin) return jsonError('Unauthorized', 401);

  const tail = parseTail(context.url.searchParams.get('tail'));
  const command = buildCommand(context.url, tail);
  if (command instanceof Response) return command;

  const abort = new AbortController();
  let upstream: SmolVmStreamResponse | undefined;
  let closed = false;
  const cleanup = () => {
    if (closed) return;
    closed = true;
    abort.abort();
    upstream?.close();
    context.request.signal.removeEventListener('abort', cleanup);
  };
  if (context.request.signal.aborted) cleanup();
  else context.request.signal.addEventListener('abort', cleanup, { once: true });

  try {
    const body: SmolVmExecRequest = { command };
    upstream = await (context.client ?? getSmolVmClient()).execStream(
      context.params.name,
      body,
      abort.signal
    );
  } catch (error) {
    cleanup();
    const normalized = normalizeSmolVmError(error instanceof Error ? error : undefined);
    return new Response(JSON.stringify(normalized), {
      status: normalized.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }

  const openedUpstream = upstream;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void pipeExecStream(controller, openedUpstream, () => closed, cleanup);
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
