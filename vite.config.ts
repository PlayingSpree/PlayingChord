/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

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
  plugins: [react(), tailwindcss()],
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
