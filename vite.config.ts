/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

// The branch a build came from, so a deployed preview can say so on screen
// (§7.1). GitHub Actions knows it without a git call; locally, ask git and
// accept an empty string if this isn't a checkout.
function currentBranch(): string {
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    return ''
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built site works from any path — a GitHub Pages
  // project page (/PlayingChord/), Netlify, or a plain file server (§2:
  // "static site, deployable to GitHub Pages / Netlify").
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BRANCH__: JSON.stringify(currentBranch()),
  },
  plugins: [
    react(),
    tailwindcss(),
    // Installable and offline (§2). 'prompt' leaves a new service worker
    // waiting instead of skipWaiting-and-reload, so an update never lands
    // mid-session: it takes over once every window of the app has closed.
    VitePWA({
      registerType: 'prompt',
      injectRegister: 'script-defer',
      // public/ PNGs (favicon, icons) come in through the glob below.
      includeManifestIcons: false,
      manifest: {
        name: 'PlayingChord',
        short_name: 'PlayingChord',
        description:
          'Practice piano chords and scales with your MIDI keyboard. Runs entirely in the browser.',
        start_url: './',
        scope: './',
        display: 'standalone',
        background_color: '#131628',
        theme_color: '#131628',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
