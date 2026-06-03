import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { DEFAULT_SMOLVM_SOCKET } from './smolvm-client';
import { getManagerStoreClient, createServiceAuthContext } from './manager-store-client';
import { getPylonAuthClient } from './pylon-auth-client';

type TerminalAdmin = { id: string; email: string; name: string | null };
type TerminalFrame = { opcode: number; payload: Buffer };
type UpgradeServer = {
  on(
    event: 'upgrade',
    listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void
  ): unknown;
};

const TERMINAL_WS_RE = /^\/api\/smolvm\/machines\/([^/]+)\/terminal\/ws$/;
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export function installSmolVmTerminalWebSocketProxy(server: UpgradeServer): void {
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (!TERMINAL_WS_RE.test(url.pathname)) return;

    void handleTerminalUpgrade(request, socket, head).catch(() => {
      socket.destroy();
    });
  });
}

export async function handleTerminalUpgrade(
  request: IncomingMessage,
  browser: Duplex,
  head: Buffer = Buffer.alloc(0)
): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  const match = url.pathname.match(TERMINAL_WS_RE);
  if (!match) return rejectUpgrade(browser, 404, 'Not Found');

  if (!validateWebSocketOrigin(request)) return rejectUpgrade(browser, 403, 'Forbidden');

  const admin = await authenticateUpgrade(request);
  if (!admin) return rejectUpgrade(browser, 401, 'Unauthorized');

  const machineName = decodeURIComponent(match[1]);
  const cols = clampTerminalSize(url.searchParams.get('cols'), 80, 240);
  const rows = clampTerminalSize(url.searchParams.get('rows'), 24, 120);
  const cmd = url.searchParams.get('cmd') || '/bin/sh';

  let upstream: Duplex;
  try {
    upstream = await openSmolVmInteractiveSocket(machineName, { cmd, cols, rows });
  } catch {
    await auditTerminal(machineName, admin, request, 'error', 'SMOLVM_PTY_UNAVAILABLE');
    return rejectUpgrade(browser, 502, 'Bad Gateway');
  }

  acceptBrowserSocket(request, browser);
  await auditTerminal(machineName, admin, request, 'open');
  bridgeTerminalSockets({ machineName, admin, request, browser, upstream });
  if (head.length > 0) browser.emit('data', head);
}

function validateWebSocketOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true;
  const expected = `http://${request.headers.host}`;
  const secureExpected = `https://${request.headers.host}`;
  return origin === expected || origin === secureExpected;
}

async function authenticateUpgrade(request: IncomingMessage): Promise<TerminalAdmin | null> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) headers.set(key, value.join(', '));
    else if (value !== undefined) headers.set(key, value);
  }

  const authClient = getPylonAuthClient();
  const session = await authClient.getSession(new Request('http://localhost/', { headers }));
  if (!session?.userId) return null;

  const user = await authClient.getUserById(session.userId);
  if (!user?.isAdmin) return null;
  return { id: user.id, email: user.email, name: user.name };
}

function clampTerminalSize(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function acceptBrowserSocket(request: IncomingMessage, socket: Duplex): void {
  const key = request.headers['sec-websocket-key'];
  if (typeof key !== 'string') throw new Error('Missing WebSocket key');
  const accept = createHash('sha1').update(`${key}${WS_GUID}`).digest('base64');
  socket.write(
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '',
      ''
    ].join('\r\n')
  );
}

function openSmolVmInteractiveSocket(
  machineName: string,
  options: { cmd: string; cols: number; rows: number }
): Promise<Duplex> {
  const params = new URLSearchParams({
    cmd: options.cmd,
    cols: String(options.cols),
    rows: String(options.rows)
  });
  const key = randomBytes(16).toString('base64');
  const socketPath = process.env.SMOLVM_SOCKET?.trim() || DEFAULT_SMOLVM_SOCKET;

  return new Promise((resolve, reject) => {
    const request = httpRequest({
      socketPath,
      method: 'GET',
      path: `/api/v1/machines/${encodeURIComponent(machineName)}/exec/interactive?${params.toString()}`,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13'
      }
    });

    request.once('upgrade', (_response, socket) => resolve(socket));
    request.once('response', (response) => {
      response.resume();
      reject(new Error(`SmolVM PTY rejected upgrade: ${response.statusCode ?? 0}`));
    });
    request.once('error', reject);
    request.end();
  });
}

function bridgeTerminalSockets(options: {
  machineName: string;
  admin: TerminalAdmin;
  request: IncomingMessage;
  browser: Duplex;
  upstream: Duplex;
}): void {
  const { machineName, admin, request, browser, upstream } = options;
  let closed = false;

  const closeBoth = (code = 1000) => {
    if (closed) return;
    closed = true;
    if (!browser.destroyed)
      browser.write(encodeWebSocketFrame({ opcode: 8, payload: closePayload(code) }));
    if (!upstream.destroyed)
      upstream.write(encodeWebSocketFrame({ opcode: 8, payload: closePayload(code) }, true));
    browser.destroy();
    upstream.destroy();
    void auditTerminal(machineName, admin, request, 'close');
  };

  const browserParser = createFrameParser((frame) => {
    if (frame.opcode === 8) return closeBoth();
    if (frame.opcode === 1 || frame.opcode === 2) {
      upstream.write(encodeWebSocketFrame(frame, true));
    }
  });

  const upstreamParser = createFrameParser((frame) => {
    if (frame.opcode === 8) return closeBoth();
    if (frame.opcode === 1 || frame.opcode === 2) {
      browser.write(encodeWebSocketFrame(frame));
    }
  });

  browser.on('data', browserParser);
  upstream.on('data', upstreamParser);
  browser.once('close', () => closeBoth());
  upstream.once('close', () => closeBoth());
  browser.once('error', () => closeBoth(1011));
  upstream.once('error', () => closeBoth(1011));
}

export function createFrameParser(
  onFrame: (frame: TerminalFrame) => void
): (chunk: Buffer) => void {
  let buffer = Buffer.alloc(0);

  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const parsed = readFrame(buffer);
      if (!parsed) break;
      onFrame(parsed.frame);
      buffer = buffer.subarray(parsed.bytesRead);
    }
  };
}

function readFrame(buffer: Buffer): { frame: TerminalFrame; bytesRead: number } | null {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  const masked = (buffer[1] & 0x80) !== 0;
  let length = buffer[1] & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buffer.length < offset + 2) return null;
    length = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buffer.length < offset + 8) return null;
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('WebSocket frame too large');
    length = Number(bigLength);
    offset += 8;
  }

  const maskOffset = offset;
  if (masked) offset += 4;
  if (buffer.length < offset + length) return null;

  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (masked) {
    const mask = buffer.subarray(maskOffset, maskOffset + 4);
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  }

  return { frame: { opcode, payload }, bytesRead: offset + length };
}

export function encodeWebSocketFrame(frame: TerminalFrame, masked = false): Buffer {
  const payload = frame.payload;
  const length = payload.length;
  const lengthBytes = length < 126 ? 0 : length <= 0xffff ? 2 : 8;
  const maskBytes = masked ? 4 : 0;
  const header = Buffer.alloc(2 + lengthBytes + maskBytes);
  header[0] = 0x80 | frame.opcode;

  if (length < 126) {
    header[1] = length | (masked ? 0x80 : 0);
  } else if (length <= 0xffff) {
    header[1] = 126 | (masked ? 0x80 : 0);
    header.writeUInt16BE(length, 2);
  } else {
    header[1] = 127 | (masked ? 0x80 : 0);
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  if (!masked) return Buffer.concat([header, payload]);

  const mask = randomBytes(4);
  mask.copy(header, 2 + lengthBytes);
  const maskedPayload = Buffer.from(payload);
  for (let i = 0; i < maskedPayload.length; i += 1) maskedPayload[i] ^= mask[i % 4];
  return Buffer.concat([header, maskedPayload]);
}

function closePayload(code: number): Buffer {
  const payload = Buffer.alloc(2);
  payload.writeUInt16BE(code, 0);
  return payload;
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(
    [`HTTP/1.1 ${status} ${message}`, 'Connection: close', 'Content-Length: 0', '', ''].join('\r\n')
  );
  socket.destroy();
}

async function auditTerminal(
  machineName: string,
  admin: TerminalAdmin,
  request: IncomingMessage,
  action: 'open' | 'close' | 'error',
  errorCode?: string
): Promise<void> {
  const forwardedFor = request.headers['x-forwarded-for'];
  const ipAddress = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(',')[0]?.trim() || request.socket.remoteAddress || undefined;

  const serviceAuth = createServiceAuthContext();
  await getManagerStoreClient().insertAuditEvent(
    {
      eventType: 'terminal.session',
      actorUserId: admin.id,
      action: `terminal.${action}`,
      details: JSON.stringify({
        machineName,
        event: action,
        ...(errorCode ? { errorCode } : {})
      }),
      ipAddress
    },
    serviceAuth ?? undefined
  );
}
