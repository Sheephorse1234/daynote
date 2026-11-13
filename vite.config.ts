import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  base: './',
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon-192.png', 'icon-512.png', 'apple-touch-icon.png'],
    manifest: {
      name: '하루결 · 메모와 일정', short_name: '하루결', description: '기기에 저장하는 나의 메모와 일정',
      lang: 'ko', start_url: './', scope: './', display: 'standalone',
      theme_color: '#f7f7f2', background_color: '#f7f7f2',
      icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }]
    },
    workbox: { globPatterns: ['**/*.{js,css,html,png,svg,ico,webmanifest}'], navigateFallback: 'index.html', cleanupOutdatedCaches: true }
  })]
});
