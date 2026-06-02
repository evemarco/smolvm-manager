import { request as httpRequest } from 'node:http';

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

export type SmolVmPlaceholder = {
  available: false;
  feature: 'exec' | 'files' | 'logs' | 'images' | 'update';
  message: string;
};

export type SmolVmRequestOptions = {
  method: 'GET' | 'POST' | 'DELETE';
  path: string;
  body?: unknown;
  responseType?: 'json' | 'text';
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

export type SmolVmClientOptions = {
  socketPath?: string;
  transport?: SmolVmTransport;
};

export type SmolVmClient = {
  socketPath: string;
  getHealth(): Promise<SmolVmHealth>;
  getCapacity(): Promise<SmolVmCapacity>;
  getMetrics(): Promise<string>;
  listMachines(): Promise<SmolVmMachineList>;
  getMachine(name: string): Promise<SmolVmMachine>;
  startMachine(name: string): Promise<SmolVmActionResult>;
  stopMachine(name: string): Promise<SmolVmActionResult>;
  deleteMachine(name: string): Promise<SmolVmActionResult>;
  getExecPlaceholder(name: string): SmolVmPlaceholder;
  getFilesPlaceholder(name: string): SmolVmPlaceholder;
  getLogsPlaceholder(name: string): SmolVmPlaceholder;
  getImagesPlaceholder(): SmolVmPlaceholder;
  getUpdatePlaceholder(): SmolVmPlaceholder;
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

function placeholder(feature: SmolVmPlaceholder['feature']): SmolVmPlaceholder {
  return {
    available: false,
    feature,
    message: `SmolVM ${feature} support is intentionally typed but not implemented in this task.`
  };
}

export function createSmolVmClient(options: SmolVmClientOptions = {}): SmolVmClient {
  const socketPath = options.socketPath ?? getConfiguredSocketPath();
  const transport = options.transport ?? requestOverUnixSocket;

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

    getExecPlaceholder: () => placeholder('exec'),
    getFilesPlaceholder: () => placeholder('files'),
    getLogsPlaceholder: () => placeholder('logs'),
    getImagesPlaceholder: () => placeholder('images'),
    getUpdatePlaceholder: () => placeholder('update')
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
