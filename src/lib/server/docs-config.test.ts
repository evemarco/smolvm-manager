import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DOCS_DIR = join(process.cwd(), 'docs');
const README_PATH = join(process.cwd(), 'README.md');

function readDoc(name: string): string {
  return readFileSync(join(DOCS_DIR, name), 'utf-8');
}

describe('docs and config assertions', () => {
  it('README documents SmolVM Manager, not generic scaffold', () => {
    const readme = readFileSync(README_PATH, 'utf-8');
    expect(readme).toContain('SmolVM Manager');
    expect(readme).toContain('smolvm-serve');
    expect(readme).not.toContain('Everything you need to build a Svelte project');
  });

  it('README includes admin:reset instruction', () => {
    const readme = readFileSync(README_PATH, 'utf-8');
    expect(readme).toContain('admin:reset');
  });

  it('README mentions systemd service and reverse proxy', () => {
    const readme = readFileSync(README_PATH, 'utf-8');
    expect(readme).toContain('systemd');
    expect(readme).toContain('reverse proxy');
  });

  it('README states direct HTTP is acceptable on LAN/Tailscale', () => {
    const readme = readFileSync(README_PATH, 'utf-8');
    expect(readme).toContain('Direct HTTP is acceptable');
  });

  it('README warns that PWA offline may require HTTPS or localhost', () => {
    const readme = readFileSync(README_PATH, 'utf-8');
    expect(readme).toContain('PWA offline support works best under HTTPS');
  });

  it('systemd unit references env file and Bun startup', () => {
    const unit = readDoc('smolvm-manager.service');
    expect(unit).toContain('EnvironmentFile=/etc/smolvm-manager/env');
    expect(unit).toContain('bun run scripts/start-manager.ts --prod');
  });

  it('systemd unit orders after and wants smolvm-serve.service', () => {
    const unit = readDoc('smolvm-manager.service');
    expect(unit).toContain('After=');
    expect(unit).toContain('smolvm-serve.service');
    expect(unit).toContain('Wants=');
  });

  it('nginx reverse proxy includes Upgrade and Connection headers', () => {
    const nginx = readDoc('reverse-proxy/nginx.conf');
    expect(nginx).toContain('proxy_set_header Upgrade $http_upgrade');
    expect(nginx).toContain('proxy_set_header Connection');
  });

  it('caddy reverse proxy includes Upgrade and Connection headers', () => {
    const caddy = readDoc('reverse-proxy/Caddyfile');
    expect(caddy).toContain('header_up Upgrade');
    expect(caddy).toContain('header_up Connection');
  });

  it('reverse proxy examples do not expose raw SmolVM socket', () => {
    const files = readdirSync(join(DOCS_DIR, 'reverse-proxy'));
    for (const file of files) {
      const content = readFileSync(join(DOCS_DIR, 'reverse-proxy', file), 'utf-8');
      expect(content).not.toContain('/tmp/smolvm.sock');
      expect(content).not.toContain('smolvm.sock');
    }
  });

  it('reverse proxy examples only upstream to manager, not raw SmolVM API', () => {
    const files = readdirSync(join(DOCS_DIR, 'reverse-proxy'));
    for (const file of files) {
      const content = readFileSync(join(DOCS_DIR, 'reverse-proxy', file), 'utf-8');
      expect(content).not.toContain('127.0.0.1:3001');
      const hasManagerUpstream =
        content.includes('127.0.0.1:3000') || content.includes('127.0.0.1:4173');
      expect(hasManagerUpstream).toBe(true);
    }
  });

  it('production env example uses absolute paths for data', () => {
    const env = readDoc('smolvm-manager.env');
    expect(env).toContain('/var/lib/smolvm-manager/data');
  });

  it('DEPLOYMENT.md documents backup/restore and log guidance', () => {
    const deploy = readDoc('DEPLOYMENT.md');
    expect(deploy).toContain('Backup');
    expect(deploy).toContain('Restore');
    expect(deploy).toContain('journalctl');
  });
});
