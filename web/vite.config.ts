import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';

// VITE_BASE: "/" locally; "/RadhaRaniMultiStore/" on GitHub Pages (set by the deploy workflow).
const base = process.env.VITE_BASE || '/';

export default defineConfig(({ command }) => ({
  base,
  plugins: [
    react(),
    // Local HTTPS (self-signed) for `npm run dev` only — phones only allow the camera on https:// (or localhost).
    ...(command === 'serve' ? [basicSsl({ name: 'radharani-local' })] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Radha Rani Multi Store',
        short_name: 'Radha Rani',
        description: 'POS, inventory and ledger for Radha Rani Multi Store',
        theme_color: '#7a1f3d',
        background_color: '#fbf7f2',
        display: 'standalone',
        orientation: 'portrait',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: {
        navigateFallback: `${base}index.html`,
        navigateFallbackDenylist: [/\/api\//],
        runtimeCaching: [
          {
            urlPattern: /\/api\/products\/\d+\/image/,
            handler: 'CacheFirst',
            options: { cacheName: 'product-images', expiration: { maxEntries: 2000, maxAgeSeconds: 60 * 60 * 24 * 30 } }
          }
        ]
      }
    })
  ],
  server: {
    // Azure Functions runs on 7071 locally — proxy so the browser sees one origin (no CORS).
    // changeOrigin: the API sees Host=localhost, so the local-only test sign-in also works from a phone on your Wi-Fi.
    proxy: { '/api': { target: 'http://localhost:7071', changeOrigin: true } },
    host: true // lets your phone on the same Wi-Fi open https://<mac-ip>:5173
  }
}));
