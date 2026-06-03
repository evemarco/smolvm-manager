import {
  getManagerStoreClient,
  createServiceAuthContext,
  type ManagerStoreClient
} from '$lib/server/manager-store-client';
import {
  getSmolVmClient,
  normalizeSmolVmError,
  type SmolVmClient,
  type SmolVmStreamResponse
} from '$lib/server/smolvm-client';

export const DEFAULT_LOG_TAIL = 200;
export const MAX_LOG_TAIL = 1000;

type StreamingContext = {
  locals: App.Locals;
  request: Request;
  url: URL;
  params: { name: string };
  client?: SmolVmClient;
  store?: ManagerStoreClient;
};

type AuditTerminalOptions = {
  locals: App.Locals;
  request: Request;
  machineName: string;
  action: 'open' | 'close' | 'error';
  errorCode?: string;
  store?: ManagerStoreClient;
};

function parseBoundedTail(value: string | null): number {
  if (!value) return DEFAULT_LOG_TAIL;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LOG_TAIL;

  return Math.min(Math.floor(parsed), MAX_LOG_TAIL);
}

function wantsFollow(url: URL): boolean {
  const value = url.searchParams.get('follow');
  return value === '1' || value === 'true';
}

function sseEncode(event: string, data: unknown): string {
  const json = JSON.stringify(data);
  return `event: ${event}\ndata: ${json}\n\n`;
}

async function pipeLogStream(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  upstream: SmolVmStreamResponse,
  follow: boolean
) {
  const decoder = new TextDecoder();
  let buffered = '';

  try {
    for await (const chunk of upstream.stream) {
      buffered += decoder.decode(chunk, { stream: true });
      const parts = buffered.split(/\r?\n/);
      buffered = parts.pop() ?? '';

      for (const line of parts) {
        if (line.length > 0) {
          controller.enqueue(encoder.encode(sseEncode('log', { line })));
        }
      }
    }

    buffered += decoder.decode();
    if (buffered.length > 0) {
      controller.enqueue(encoder.encode(sseEncode('log', { line: buffered })));
    }

    if (!follow) {
      controller.enqueue(encoder.encode(sseEncode('end', { reason: 'tail-complete' })));
      controller.close();
    }
  } catch {
    controller.enqueue(encoder.encode(sseEncode('error', { message: 'Log stream disconnected.' })));
    controller.close();
  } finally {
    upstream.close();
  }
}

export async function createLogsSseResponse(context: StreamingContext): Promise<Response> {
  if (!context.locals.admin) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const tail = parseBoundedTail(context.url.searchParams.get('tail'));
  const follow = wantsFollow(context.url);
  const abort = new AbortController();

  context.request.signal.addEventListener('abort', () => abort.abort(), { once: true });

  let upstream: SmolVmStreamResponse;
  try {
    upstream = await (context.client ?? getSmolVmClient()).openLogStream(context.params.name, {
      tail,
      follow,
      signal: abort.signal
    });
  } catch (error) {
    const normalized = normalizeSmolVmError(error);
    return new Response(JSON.stringify(normalized), {
      status: normalized.status,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseEncode('ready', { tail, follow })));
      void pipeLogStream(controller, encoder, upstream, follow);
    },
    cancel() {
      abort.abort();
      upstream.close();
    }
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

function clientIp(request: Request): string | undefined {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    undefined
  );
}

function noStoreJson(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...init.headers
    }
  });
}

export async function auditTerminalEvent(options: AuditTerminalOptions): Promise<void> {
  const details = {
    machineName: options.machineName,
    event: options.action,
    ...(options.errorCode ? { errorCode: options.errorCode } : {})
  };

  const serviceAuth = createServiceAuthContext();
  await (options.store ?? getManagerStoreClient()).insertAuditEvent(
    {
      eventType: 'terminal.session',
      actorUserId: options.locals.admin?.id,
      action: `terminal.${options.action}`,
      details: JSON.stringify(details),
      ipAddress: clientIp(options.request)
    },
    serviceAuth ?? undefined
  );
}

export async function createTerminalHandshakeResponse(
  context: StreamingContext
): Promise<Response> {
  if (!context.locals.admin) {
    return noStoreJson({ error: 'Unauthorized' }, { status: 401 });
  }

  await auditTerminalEvent({
    locals: context.locals,
    request: context.request,
    machineName: context.params.name,
    action: 'error',
    errorCode: 'WEBSOCKET_UPGRADE_UNAVAILABLE',
    store: context.store
  });

  return new Response(
    JSON.stringify({
      error: 'WebSocket upgrade required',
      code: 'WEBSOCKET_UPGRADE_REQUIRED',
      message: 'Use the authenticated WebSocket endpoint at /terminal/ws for interactive PTY I/O.'
    }),
    {
      status: 426,
      headers: {
        'Content-Type': 'application/json',
        Upgrade: 'websocket',
        'Cache-Control': 'no-store'
      }
    }
  );
}
