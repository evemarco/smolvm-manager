import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';
import { installSmolVmTerminalWebSocketProxy } from './src/lib/server/smolvm-terminal-ws';

function smolVmTerminalWebSockets(): Plugin {
  return {
    name: 'smolvm-terminal-websockets',
    configureServer(server: ViteDevServer) {
      if (server.httpServer) installSmolVmTerminalWebSocketProxy(server.httpServer);
    },
    configurePreviewServer(server: PreviewServer) {
      installSmolVmTerminalWebSocketProxy(server.httpServer);
    }
  };
}

export default defineConfig({
  plugins: [
    smolVmTerminalWebSockets(),
    tailwindcss(),
    sveltekit(),
    SvelteKitPWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'SmolVM Manager',
        short_name: 'SmolVM',
        description: 'LAN-ready manager for local SmolVM operations.',
        theme_color: '#020617',
        background_color: '#020617',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }]
      }
    })
  ]
});
