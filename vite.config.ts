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

// Routes that must never be served from the service worker cache:
// - /api/* — all authenticated/dynamic API endpoints
// - /login, /setup, /logout — auth pages
// - Terminal WebSocket upgrades
const swDenylist = [/^\/api\//, /^\/login/, /^\/setup/, /^\/logout/, /\/terminal\/ws$/];

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
      },
      workbox: {
        // Only precache static assets (JS, CSS, HTML, fonts, images)
        globPatterns: ['**/*.{js,css,html,svg,ico,webmanifest}'],
        // Never serve navigation fallback for API or auth routes
        navigateFallbackDenylist: swDenylist,
        // No runtime caching — all dynamic/authenticated content must be fetched fresh
        runtimeCaching: []
      }
    })
  ]
});
