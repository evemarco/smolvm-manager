#!/usr/bin/env bun
/**
 * Local quality gate for SmolVM Manager.
 * Runs the full verification pipeline:
 *   check → lint → format:check → unit tests → build → e2e tests
 *
 * Usage:
 *   bun run scripts/quality-gate.ts
 *
 * Environment:
 *   PYLON_AUTH_MOCK=true PYLON_STORE_MOCK=true (set automatically for e2e)
 */

const steps = [
  { name: 'Type check', cmd: ['bun', 'run', 'check'] },
  { name: 'Lint', cmd: ['bun', 'run', 'lint'] },
  { name: 'Format check', cmd: ['bun', 'run', 'format:check'] },
  { name: 'Unit tests', cmd: ['bun', 'test', 'src'] },
  { name: 'Build', cmd: ['bun', 'run', 'build'] },
  {
    name: 'E2E tests',
    cmd: ['bun', 'run', 'test:e2e'],
    env: { PYLON_AUTH_MOCK: 'true', PYLON_STORE_MOCK: 'true' }
  }
];

let allPassed = true;
const results: Array<{ name: string; status: string; durationMs: number }> = [];

for (const step of steps) {
  const start = Date.now();
  process.stdout.write(`[gate] ${step.name} ... `);
  const proc = Bun.spawn(step.cmd, {
    stdout: 'inherit',
    stderr: 'inherit',
    env: { ...process.env, ...step.env }
  });
  const exitCode = await proc.exited;
  const duration = Date.now() - start;
  if (exitCode === 0) {
    results.push({ name: step.name, status: 'PASS', durationMs: duration });
    console.log(`PASS (${duration}ms)`);
  } else {
    results.push({ name: step.name, status: 'FAIL', durationMs: duration });
    console.log(`FAIL (${duration}ms)`);
    allPassed = false;
  }
}

console.log('');
console.log('=== Quality Gate Summary ===');
for (const r of results) {
  console.log(`  ${r.status}  ${r.name} (${r.durationMs}ms)`);
}
console.log('');

if (allPassed) {
  console.log('All gates passed.');
  process.exit(0);
} else {
  console.log('Some gates failed.');
  process.exit(1);
}

export {};
