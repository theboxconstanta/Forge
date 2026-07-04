import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { sentryVitePlugin } from '@sentry/vite-plugin'

export default defineConfig({
  // sourcemap:true e necesar ca sentryVitePlugin sa aiba ce incarca - fara el,
  // Sentry primeste doar bundle-ul minificat si stack trace-urile raman ilizibile
  // (pozitie in fisierul minificat, nu linia reala din App.jsx).
  build: {
    sourcemap: true,
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'pwa-icon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Forge',
        short_name: 'Forge',
        description: 'Aplicație CrossFit pentru antrenamente, PR-uri și clase',
        theme_color: '#0E0E0E',
        background_color: '#0E0E0E',
        display: 'fullscreen',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'ro',
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        importScripts: ['/push-handler.js'],
      },
    }),
    // Trebuie ultimul plugin din lista (recomandarea Sentry) - are nevoie sa
    // vada bundle-ul final generat de celelalte plugin-uri ca sa poata
    // rescrie/incarca source maps-urile corecte. Ruleaza doar cand
    // SENTRY_AUTH_TOKEN e prezent (setat pe Vercel, nu si local) - fara el,
    // pluginul se dezactiveaza singur (`disable`), buildul local ramane
    // neschimbat. sourcemaps.filesToDeleteAfterUpload sterge .map-urile din
    // dist dupa upload, ca sursa reala sa nu ajunga public-servita alaturi
    // de bundle.
    sentryVitePlugin({
      org: 'forge-zw',
      project: 'sentry-cyan-harbor',
      url: 'https://de.sentry.io',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        filesToDeleteAfterUpload: ['./dist/**/*.js.map'],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.js'],
  },
})
