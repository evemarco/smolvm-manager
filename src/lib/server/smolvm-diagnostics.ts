export type SmolVmDiagnosticLevel = 'error';

export type SmolVmDiagnosticInput = {
  readonly level: SmolVmDiagnosticLevel;
  readonly code: string;
  readonly message: string;
  readonly status: number;
  readonly details?: unknown;
};

export type SmolVmDiagnosticEntry = SmolVmDiagnosticInput & {
  readonly id: number;
  readonly timestamp: string;
};

export type SmolVmDiagnostics = {
  readonly record: (input: SmolVmDiagnosticInput) => void;
  readonly snapshot: () => readonly SmolVmDiagnosticEntry[];
  readonly subscribe: (listener: (entry: SmolVmDiagnosticEntry) => void) => () => void;
};

const DEFAULT_DIAGNOSTIC_LIMIT = 200;
const MAX_MESSAGE_LENGTH = 8_000;

export function createSmolVmDiagnostics(
  limit: number = DEFAULT_DIAGNOSTIC_LIMIT
): SmolVmDiagnostics {
  const capacity = Math.max(1, Math.floor(limit));
  const entries: SmolVmDiagnosticEntry[] = [];
  const listeners = new Set<(entry: SmolVmDiagnosticEntry) => void>();
  let nextId = 1;

  return {
    record(input) {
      const entry: SmolVmDiagnosticEntry = {
        ...input,
        id: nextId,
        timestamp: new Date().toISOString(),
        message: input.message.slice(0, MAX_MESSAGE_LENGTH)
      };
      nextId += 1;
      entries.push(entry);
      if (entries.length > capacity) entries.splice(0, entries.length - capacity);
      for (const listener of listeners) listener(entry);
    },
    snapshot() {
      return entries.slice();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

export const smolVmDiagnostics = createSmolVmDiagnostics();
