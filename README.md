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

Stack: React + TypeScript + Vite, Zustand, Tailwind CSS, VexFlow (notation), Vitest.
Client-side only — no accounts, no server; everything persists to `localStorage`.
