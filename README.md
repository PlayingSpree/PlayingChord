# PlayingChord

A web app for practicing piano chords with a MIDI keyboard: the app shows a random chord
from a chosen preset, you play it, and it validates the voicing and moves on.

See **[DESIGN.md](doc/DESIGN.md)** for the full product/technical design.

> Created by an LLM (Claude Code).

## Requirements

- A browser with **Web MIDI** support: Chrome, Edge, or Opera (Firefox 108+ with
  permission; Safari is not supported).
- A **MIDI keyboard** — the app has no mouse/QWERTY fallback.
- Node.js 24+ for development.

## Development

```sh
npm install
npm run dev        # start the dev server
npm test           # run unit tests (vitest)
npm run lint       # oxlint
npm run format     # prettier
npm run build      # typecheck + production build
```

No MIDI keyboard at hand? `http://localhost:5173/?midi=sim` (dev only) simulates one,
played from the QWERTY row (A = C4, W = C♯4, … ' = F5), with Z / X shifting it an
octave down / up for the longer scale runs.

Stack: React + TypeScript + Vite, Zustand, Tailwind CSS, VexFlow (notation), Vitest.
Client-side only — no accounts, no server; everything persists to `localStorage`.

## Deployment

The app is a fully static site. `npm run build` produces `dist/` with a **relative
base path**, so the output runs from any static host or subdirectory unchanged —
no server configuration, no environment variables.

**GitHub Pages** is wired up in `.github/workflows/deploy.yml`: every push to
`master` builds, tests, and publishes. One-time setup for a fork/new remote: repo
**Settings → Pages → Build and deployment → Source: "GitHub Actions"**.

To try an unreleased change on the real site, push it to `dev` (or `dev/<name>`)
and run the Deploy workflow manually — **Actions → Deploy → Run workflow**, with
that branch selected. There is only one Pages site per repo, so this *replaces*
the live build; re-run the workflow from `master` to put production back. The
`github-pages` environment allows exactly `master`, `dev`, and `dev/**`, so any
other branch has to be merged into `dev` first.

The site is a PWA with a service worker, which changes how a new deploy
arrives: an open or installed copy of the app keeps running the build it started
with, and picks up the new one only after **all** of its windows and tabs are closed
and it is opened again. When switching the live site between a preview and
`master`, check the build tag on Home to see which build you're actually on.
The service worker isn't active in `npm run dev`; use `npm run build && npm run
preview` to try install and offline behavior locally.

Any other static host (Netlify, Cloudflare Pages, `python -m http.server` on a
LAN) just serves `dist/` as-is. Remember the site still needs a Web-MIDI-capable
browser (Chrome/Edge/Opera) and a MIDI keyboard on the *visiting* machine.
