# PlayingChord

A web app for practicing piano chords with a MIDI keyboard: the app shows a random chord
from a chosen preset, you play it, and it validates the voicing and moves on.

- **[DESIGN.md](DESIGN.md)** — full product/technical design.
- **[PLAN.md](PLAN.md)** — build plan (phases and milestones).

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
played from the QWERTY row (A = C4, W = C♯4, …).

Stack: React + TypeScript + Vite, Zustand, Tailwind CSS, VexFlow (notation), Vitest.
Client-side only — no accounts, no server; everything persists to `localStorage`.

## Deployment

The app is a fully static site. `npm run build` produces `dist/` with a **relative
base path**, so the output runs from any static host or subdirectory unchanged —
no server configuration, no environment variables.

**GitHub Pages** is wired up in `.github/workflows/deploy.yml`: every push to
`master` builds, tests, and publishes. One-time setup for a fork/new remote: repo
**Settings → Pages → Build and deployment → Source: "GitHub Actions"**.

Any other static host (Netlify, Cloudflare Pages, `python -m http.server` on a
LAN) just serves `dist/` as-is. Remember the site still needs a Web-MIDI-capable
browser (Chrome/Edge/Opera) and a MIDI keyboard on the *visiting* machine.
