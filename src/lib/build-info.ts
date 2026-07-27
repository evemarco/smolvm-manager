// Build metadata injected by vite.config.ts `define`. The typeof guards keep
// bare `bun test` (no Vite pipeline) from throwing a ReferenceError.
export const APP_COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown';
export const APP_BUILD_TIME: string =
  typeof __APP_BUILD_TIME__ === 'string' ? __APP_BUILD_TIME__ : 'unknown';
