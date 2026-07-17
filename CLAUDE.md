# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

PlayingChord: a client-side-only web app for practicing piano chords with a MIDI
keyboard. React + TypeScript + Vite + Zustand + Tailwind; no backend, everything
persists to `localStorage`. Requires Web MIDI (Chrome/Edge/Opera; no Safari) and a
physical MIDI keyboard — there is deliberately no mouse/QWERTY fallback.

## DESIGN.md — the spec

All requirements live in DESIGN.md, cited by section (e.g. §6.2 attempt lifecycle,
§3.3 voicing rules). Read the sections a change touches before coding; don't
re-decide things it already resolves (§9 lists resolved questions). When a change
intentionally alters product behavior, update DESIGN.md in the same commit.

The app is feature-complete against the spec. The build-era docs (PLAN.md,
PROGRESS.md) are retired — the phase-by-phase build log lives in git history.

## Commands

```sh
npm run dev                        # dev server (http://localhost:5173)
#   …?midi=sim                     # dev-only simulated MIDI, played via QWERTY (A=C4…)
npm test                           # all tests, single run
npm test -- src/theory/foo.test.ts # single test file
npm test -- -t "name"              # tests matching name
npm run test:watch                 # vitest watch mode
npm run lint                       # oxlint (not ESLint)
npm run format                     # prettier --write (md files ignored)
npm run build                      # tsc -b typecheck + vite build
```

CI (GitHub Actions) runs lint → format:check → test → build; run these locally
before committing.

## Architecture (DESIGN.md §8)

The core rule: **`src/theory/`, `src/practice/`, and `src/storage/` are pure
TypeScript with no DOM or MIDI dependencies** — all chord matching, session/attempt
logic, weighting, and persistence schema code lives there and is unit-tested
directly. Only the edges touch the platform:

- `src/midi/` — Web MIDI wrapper behind an interface with a simulated
  implementation, so everything is developable/testable without hardware.
- `src/audio/` — Web Audio correct-chime (the only sound; misses are silent).
- `src/components/` + `src/store/` (Zustand) — UI layer.

Domain concepts that span modules: a **Chord** is root pitch-class + `ChordType`
(interval data); a **VoicingRule** is data — either composable constraints (bass /
span / doubling) or a two-hand degree pattern — and matching held MIDI notes is
always against the *rule*, never against the example voicing drawn on the staff;
stats and weighted generation are keyed per **combo** `(root, typeId, voicingId)`.

## Conventions

- TypeScript is `strict` **plus `noUncheckedIndexedAccess`** (set manually; the
  Vite template doesn't include it) — expect `T | undefined` from array indexing.
- Prettier: no semicolons, single quotes; `*.md` is ignored (docs stay
  hand-formatted). Line endings are LF, enforced via `.gitattributes`.
- New chord types / built-in voicing rules are added as *data* in `src/theory/`,
  not as matcher code changes.
