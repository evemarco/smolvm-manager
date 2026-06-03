import { request as httpRequest, type IncomingMessage } from 'node:http';

export const DEFAULT_SMOLVM_SOCKET = '/tmp/smolvm.sock';

export const SMOLVM_ERROR_CODES = {
  UNREACHABLE: 'SMOLVM_UNREACHABLE',
  BAD_RESPONSE: 'SMOLVM_BAD_RESPONSE',
  REQUEST_FAILED: 'SMOLVM_REQUEST_FAILED'
} as const;

export type SmolVmErrorCode = (typeof SMOLVM_ERROR_CODES)[keyof typeof SMOLVM_ERROR_CODES];

export type SmolVmErrorJson = {
  code: SmolVmErrorCode;
  message: string;
  status: number;
  details?: unknown;
};

export class SmolVmError extends Error {
  code: SmolVmErrorCode;
  status: number;
  details?: unknown;

  constructor(code: SmolVmErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'SmolVmError';
    this.code = code;
    this.status = status;
    this.details = details;
  }

  toJSON(): SmolVmErrorJson {
    return normalizeSmolVmError(this);
  }
}

export type SmolVmHealth = {
  status: string;
  version?: string;
  [key: string]: unknown;
};

export type SmolVmCapacity = Record<string, unknown>;

export type SmolVmMachine = {
  name: string;
  status?: string;
  state?: string;
  [key: string]: unknown;
};

export type SmolVmMachineList = {
  machines: SmolVmMachine[];
  [key: string]: unknown;
};

export type SmolVmActionResult = Record<string, unknown> | null;

export type SmolVmExecEnvVar = {
  name: string;
  value: string;
};

export type SmolVmExecRequest = {
  command: string[];
  env?: SmolVmExecEnvVar[];
  workdir?: string;
  timeoutSecs?: number;
  stdin?: string;
  background?: boolean;
};

export type SmolVmExecResponse = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type SmolVmFileDownload = {
  path: string;
  content: string;
  encoding: 'utf-8';
};

export type SmolVmImageInfo = {
  reference: string;
  digest: string;
  size: number;
  architecture: string;
  os: string;
  layerCount: number;
};

export type SmolVmImageList = {
  machine: string;
  images: SmolVmImageInfo[];
};

export type SmolVmPullImageRequest = {
  image: string;
  ociPlatform?: string;
  proxy?: string;
  noProxy?: string;
};

export type SmolVmPullImageResponse = {
  machine: string;
  image: SmolVmImageInfo;
};

export type SmolVmRequestOptions = {
  method: 'GET' | 'POST' | 'DELETE' | 'PATCH' | 'PUT';
  path: string;
  body?: unknown;
  responseType?: 'json' | 'text';
};

export type SmolVmStreamOptions = {
  method: 'GET' | 'POST';
  path: string;
  body?: unknown;
  signal?: AbortSignal;
};

export type SmolVmTransportResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  body: string;
};

export type SmolVmTransport = (
  socketPath: string,
  options: SmolVmRequestOptions
) => Promise<SmolVmTransportResponse>;

export type SmolVmStreamResponse = {
  status: number;
  headers: Record<string, string | undefined>;
  stream: AsyncIterable<Uint8Array>;
  close: () => void;
};

export type SmolVmStreamTransport = (
  socketPath: string,
  options: SmolVmStreamOptions
) => Promise<SmolVmStreamResponse>;

export type SmolVmClientOptions = {
  socketPath?: string;
  transport?: SmolVmTransport;
  streamTransport?: SmolVmStreamTransport;
};

export type SmolVmLogStreamOptions = {
  tail: number;
  follow: boolean;
  signal?: AbortSignal;
};

export type SmolVmCreateMachineBody = Record<string, unknown>;

export type SmolVmClient = {
  socketPath: string;
  getHealth(): Promise<SmolVmHealth>;
  getCapacity(): Promise<SmolVmCapacity>;
  getMetrics(): Promise<string>;
  listMachines(): Promise<SmolVmMachineList>;
  getMachine(name: string): Promise<SmolVmMachine>;
  createMachine(body: SmolVmCreateMachineBody): Promise<SmolVmMachine>;
  startMachine(name: string): Promise<SmolVmActionResult>;
  stopMachine(name: string): Promise<SmolVmActionResult>;
  deleteMachine(name: string): Promise<SmolVmActionResult>;
  openLogStream(name: string, options: SmolVmLogStreamOptions): Promise<SmolVmStreamResponse>;
  execMachine(name: string, body: SmolVmExecRequest): Promise<SmolVmExecResponse>;
  downloadMachineFile(name: string, path: string): Promise<SmolVmFileDownload>;
  listMachineImages(name: string): Promise<SmolVmImageList>;
  pullMachineImage(name: string, body: SmolVmPullImageRequest): Promise<SmolVmPullImageResponse>;
};

function getConfiguredSocketPath(): string {
  return process.env.SMOLVM_SOCKET?.trim() || DEFAULT_SMOLVM_SOCKET;
}

function safeMachinePath(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new SmolVmError(SMOLVM_ERROR_CODES.REQUEST_FAILED, 'Machine name is required.', 400);
  }
  return encodeURIComponent(trimmed);
}

function safeGuestFilePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed.includes('\0')) {
    throw new SmolVmError(SMOLVM_ERROR_CODES.REQUEST_FAILED, 'Guest file path is required.', 400);
  }

  const segments = trimmed
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean);

  if (segments.length === 0 || segments.some((segment) => segment === '..')) {
    throw new SmolVmError(SMOLVM_ERROR_CODES.REQUEST_FAILED, 'Guest file path is invalid.', 400);
  }

  return segments.map(encodeURIComponent).join('/');
}

function parseJson(text: string, status: number): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new SmolVmError(SMOLVM_ERROR_CODES.BAD_RESPONSE, 'SmolVM returned invalid JSON.', 502, {
      upstreamStatus: status
    });
  }
}

function assertObject(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SmolVmError(SMOLVM_ERROR_CODES.BAD_RESPONSE, message, 502);
  }
  return value as Record<string, unknown>;
}

function asMachine(value: unknown): SmolVmMachine {
  const object = assertObject(value, 'SmolVM returned an invalid machine payload.');
  if (typeof object.name !== 'string') {
    throw new SmolVmError(
      SMOLVM_ERROR_CODES.BAD_RESPONSE,
      'SmolVM machine payload is missing a name.',
      502
    );
  }
  return object as SmolVmMachine;
}

function asMachineList(value: unknown): SmolVmMachineList {
  const object = assertObject(value, 'SmolVM returned an invalid machine list.');
  if (!Array.isArray(object.machines)) {
    throw new SmolVmError(
      SMOLVM_ERROR_CODES.BAD_RESPONSE,
      'SmolVM machine list is missing machines[].',
      502
    );
  }
  return {
    ...object,
    machines: object.machines.map(asMachine)
  };
}

function asExecResponse(value: unknown): SmolVmExecResponse {
  const object = assertObject(value, 'SmolVM returned an invalid exec payload.');
  const exitCode = object.exitCode ?? object.exit_code;
  if (typeof exitCode !== 'number' || typeof object.stdout !== 'string' || typeof object.stderr !== 'string') {
    throw new SmolVmError(
      SMOLVM_ERROR_CODES.BAD_RESPONSE,
      'SmolVM exec payload is missing exitCode/stdout/stderr.',
      502
    );
  }
  return {
    exitCode,
    stdout: object.stdout,
    stderr: object.stderr
  };
}

function asImageInfo(value: unknown): SmolVmImageInfo {
  const object = assertObject(value, 'SmolVM returned an invalid image payload.');
  const layerCount = object.layerCount ?? object.layer_count;
  if (
    typeof object.reference !== 'string' ||
    typeof object.digest !== 'string' ||
    typeof object.size !== 'number' ||
    typeof object.architecture !== 'string' ||
    typeof object.os !== 'string' ||
    typeof layerCount !== 'number'
  ) {
    throw new SmolVmError(
      SMOLVM_ERROR_CODES.BAD_RESPONSE,
      'SmolVM image payload is missing required fields.',
      502
    );
  }
  return {
    reference: object.reference,
    digest: object.digest,
    size: object.size,
    architecture: object.architecture,
    os: object.os,
    layerCount
  };
}

function asImageList(machine: string, value: unknown): SmolVmImageList {
  const object = assertObject(value, 'SmolVM returned an invalid image list.');
  if (!Array.isArray(object.images)) {
    throw new SmolVmError(
      SMOLVM_ERROR_CODES.BAD_RESPONSE,
      'SmolVM image list is missing images[].',
      502
    );
  }
  return {
    machine,
    images: object.images.map(asImageInfo)
  };
}

function asPullImageResponse(machine: string, value: unknown): SmolVmPullImageResponse {
  const object = assertObject(value, 'SmolVM returned an invalid image pull payload.');
  return {
    machine,
    image: asImageInfo(object.image)
  };
}

async function requestOverUnixSocket(
  socketPath: string,
  options: SmolVmRequestOptions
): Promise<SmolVmTransportResponse> {
  const requestBody = options.body === undefined ? undefined : JSON.stringify(options.body);

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        socketPath,
        method: options.method,
        path: options.path,
        headers: {
          Accept: options.responseType === 'text' ? 'text/plain' : 'application/json',
          ...(requestBody
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody).toString()
              }
            : {})
        }
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        response.on('end', () => {
          const headers: Record<string, string | undefined> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            headers[key] = Array.isArray(value) ? value.join(', ') : value;
          }
          resolve({
            status: response.statusCode ?? 0,
            headers,
            body: Buffer.concat(chunks).toString('utf8')
          });
        });
      }
    );

    request.on('error', (error) => reject(error));
    if (requestBody) request.write(requestBody);
    request.end();
  });
}

async function streamOverUnixSocket(
  socketPath: string,
  options: SmolVmStreamOptions
): Promise<SmolVmStreamResponse> {
  const requestBody = options.body === undefined ? undefined : JSON.stringify(options.body);

  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        socketPath,
        method: options.method,
        path: options.path,
        headers: {
          Accept: 'text/plain, text/event-stream',
          ...(requestBody
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestBody).toString()
              }
            : {})
        }
      },
      (response: IncomingMessage) => {
        const headers: Record<string, string | undefined> = {};
        for (const [key, value] of Object.entries(response.headers)) {
          headers[key] = Array.isArray(value) ? value.join(', ') : value;
        }

        resolve({
          status: response.statusCode ?? 0,
          headers,
          stream: response as AsyncIterable<Uint8Array>,
          close: () => request.destroy()
        });
      }
    );

    const abort = () => request.destroy(new Error('Request aborted'));
    options.signal?.addEventListener('abort', abort, { once: true });
    request.on('error', (error) => reject(error));
    request.on('close', () => options.signal?.removeEventListener('abort', abort));
    if (requestBody) request.write(requestBody);
    request.end();
  });
}

async function callSmolVm<T>(
  socketPath: string,
  transport: SmolVmTransport,
  options: SmolVmRequestOptions,
  coerce: (value: unknown) => T
): Promise<T> {
  let response: SmolVmTransportResponse;
  try {
    response = await transport(socketPath, options);
  } catch {
    throw new SmolVmError(
      SMOLVM_ERROR_CODES.UNREACHABLE,
      'SmolVM is unreachable on its local Unix socket.',
      503
    );
  }

  if (response.status < 200 || response.status >= 300) {
    const details = response.body ? parseJsonOrText(response.body) : undefined;
    throw new SmolVmError(
      SMOLVM_ERROR_CODES.REQUEST_FAILED,
      'SmolVM request failed.',
      response.status || 502,
      details
    );
  }

  if (options.responseType === 'text') {
    return coerce(response.body);
  }

  return coerce(parseJson(response.body, response.status));
}

function parseJsonOrText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function createSmolVmClient(options: SmolVmClientOptions = {}): SmolVmClient {
  const socketPath = options.socketPath ?? getConfiguredSocketPath();
  const transport = options.transport ?? requestOverUnixSocket;
  const streamTransport = options.streamTransport ?? streamOverUnixSocket;

  return {
    socketPath,

    getHealth() {
      return callSmolVm(socketPath, transport, { method: 'GET', path: '/health' }, (value) => {
        const object = assertObject(value, 'SmolVM returned an invalid health payload.');
        if (typeof object.status !== 'string') {
          throw new SmolVmError(
            SMOLVM_ERROR_CODES.BAD_RESPONSE,
            'SmolVM health payload is missing status.',
            502
          );
        }
        return object as SmolVmHealth;
      });
    },

    getCapacity() {
      return callSmolVm(socketPath, transport, { method: 'GET', path: '/capacity' }, (value) =>
        assertObject(value, 'SmolVM returned an invalid capacity payload.')
      );
    },

    getMetrics() {
      return callSmolVm(
        socketPath,
        transport,
        { method: 'GET', path: '/metrics', responseType: 'text' },
        (value) => String(value)
      );
    },

    listMachines() {
      return callSmolVm(
        socketPath,
        transport,
        { method: 'GET', path: '/api/v1/machines' },
        asMachineList
      );
    },

    getMachine(name) {
      return callSmolVm(
        socketPath,
        transport,
        { method: 'GET', path: `/api/v1/machines/${safeMachinePath(name)}` },
        asMachine
      );
    },

    startMachine(name) {
      return callSmolVm(
        socketPath,
        transport,
        { method: 'POST', path: `/api/v1/machines/${safeMachinePath(name)}/start` },
        (value) => value as SmolVmActionResult
      );
    },

    stopMachine(name) {
      return callSmolVm(
        socketPath,
        transport,
        { method: 'POST', path: `/api/v1/machines/${safeMachinePath(name)}/stop` },
        (value) => value as SmolVmActionResult
      );
    },

    deleteMachine(name) {
      return callSmolVm(
        socketPath,
        transport,
        { method: 'DELETE', path: `/api/v1/machines/${safeMachinePath(name)}` },
        (value) => value as SmolVmActionResult
      );
    },

    async openLogStream(name, options) {
      const params = new URLSearchParams({ tail: String(options.tail) });
      if (options.follow) params.set('follow', '1');

      let response: SmolVmStreamResponse;
      try {
        response = await streamTransport(socketPath, {
          method: 'GET',
          path: `/api/v1/machines/${safeMachinePath(name)}/logs?${params.toString()}`,
          signal: options.signal
        });
      } catch {
        throw new SmolVmError(
          SMOLVM_ERROR_CODES.UNREACHABLE,
          'SmolVM is unreachable on its local Unix socket.',
          503
        );
      }

      if (response.status < 200 || response.status >= 300) {
        response.close();
        throw new SmolVmError(
          SMOLVM_ERROR_CODES.REQUEST_FAILED,
          'SmolVM log stream request failed.',
          response.status || 502
        );
      }

      return response;
    },

    createMachine(body) {
      return callSmolVm(
        socketPath,
        transport,
        {
          method: 'POST',
          path: '/api/v1/machines',
          body
        },
        asMachine
      );
    },

    execMachine(name, body) {
      return callSmolVm(
        socketPath,
        transport,
        {
          method: 'POST',
          path: `/api/v1/machines/${safeMachinePath(name)}/exec`,
          body
        },
        asExecResponse
      );
    },

    downloadMachineFile(name, path) {
      const guestPath = safeGuestFilePath(path);
      return callSmolVm(
        socketPath,
        transport,
        {
          method: 'GET',
          path: `/api/v1/machines/${safeMachinePath(name)}/files/${guestPath}`,
          responseType: 'text'
        },
        (value) => ({ path: `/${guestPath}`, content: String(value), encoding: 'utf-8' })
      );
    },

    listMachineImages(name) {
      return callSmolVm(
        socketPath,
        transport,
        { method: 'GET', path: `/api/v1/machines/${safeMachinePath(name)}/images` },
        (value) => asImageList(name, value)
      );
    },

    pullMachineImage(name, body) {
      return callSmolVm(
        socketPath,
        transport,
        {
          method: 'POST',
          path: `/api/v1/machines/${safeMachinePath(name)}/images/pull`,
          body
        },
        (value) => asPullImageResponse(name, value)
      );
    }
  };
}

export function getSmolVmClient(): SmolVmClient {
  return createSmolVmClient();
}

export function normalizeSmolVmError(error: unknown): SmolVmErrorJson {
  if (error instanceof SmolVmError) {
    return {
      code: error.code,
      message: error.message,
      status: error.status,
      ...(error.details === undefined ? {} : { details: error.details })
    };
  }

  return {
    code: SMOLVM_ERROR_CODES.BAD_RESPONSE,
    message: 'SmolVM returned an unexpected response.',
    status: 502
  };
}
