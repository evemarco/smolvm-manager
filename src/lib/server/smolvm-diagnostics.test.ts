import { expect, test } from 'bun:test';
import { createSmolVmDiagnostics } from './smolvm-diagnostics';

test('smolvm diagnostics retain a bounded chronological backend history', () => {
  const diagnostics = createSmolVmDiagnostics(2);

  diagnostics.record({ level: 'error', code: 'FIRST', message: 'first', status: 500 });
  diagnostics.record({ level: 'error', code: 'SECOND', message: 'second', status: 502 });
  diagnostics.record({ level: 'error', code: 'THIRD', message: 'third', status: 503 });

  expect(diagnostics.snapshot().map((entry) => entry.code)).toEqual(['SECOND', 'THIRD']);
});

test('smolvm diagnostics notify subscribers with the recorded backend event', () => {
  const diagnostics = createSmolVmDiagnostics();
  const received: string[] = [];
  const unsubscribe = diagnostics.subscribe((entry) => received.push(entry.message));

  diagnostics.record({
    level: 'error',
    code: 'START_FAILED',
    message: 'start failed',
    status: 500
  });
  unsubscribe();
  diagnostics.record({ level: 'error', code: 'STOP_FAILED', message: 'stop failed', status: 500 });

  expect(received).toEqual(['start failed']);
});
