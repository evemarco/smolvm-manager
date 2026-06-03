import { expect, test, describe } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const viteConfigPath = resolve(import.meta.dir, '../../vite.config.ts');
const viteConfig = readFileSync(viteConfigPath, 'utf-8');

describe('PWA cache safety', () => {
  test('swDenylist excludes /api/ routes from service worker navigation cache', () => {
    expect(viteConfig).toContain('/^\\/api\\//');
  });

  test('swDenylist excludes /login from service worker navigation cache', () => {
    expect(viteConfig).toContain('/^\\/login/');
  });

  test('swDenylist excludes /setup from service worker navigation cache', () => {
    expect(viteConfig).toContain('/^\\/setup/');
  });

  test('swDenylist excludes /logout from service worker navigation cache', () => {
    expect(viteConfig).toContain('/^\\/logout/');
  });

  test('swDenylist excludes terminal WebSocket from service worker navigation cache', () => {
    expect(viteConfig).toContain('/\\/terminal\\/ws$/');
  });

  test('runtimeCaching is empty (no dynamic route caching)', () => {
    expect(viteConfig).toContain('runtimeCaching: []');
  });

  test('globPatterns only includes static asset types', () => {
    expect(viteConfig).toContain("'**/*.{js,css,html,svg,ico,webmanifest}'");
  });

  test('manifest display is standalone for PWA installability', () => {
    expect(viteConfig).toContain("display: 'standalone'");
  });

  test('manifest has required PWA fields', () => {
    expect(viteConfig).toContain('name:');
    expect(viteConfig).toContain('short_name:');
    expect(viteConfig).toContain('start_url:');
    expect(viteConfig).toContain('theme_color:');
    expect(viteConfig).toContain('background_color:');
  });

  test('registerType is autoUpdate', () => {
    expect(viteConfig).toContain("registerType: 'autoUpdate'");
  });
});
