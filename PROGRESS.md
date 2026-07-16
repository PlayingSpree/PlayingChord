# PlayingChord — Progress Log

Running summary of build progress against [PLAN.md](PLAN.md). Newest entry first.

## Status

| Phase | Status |
|-------|--------|
| 0 — Scaffolding | ✅ Done (2026-07-15) |
| 1 — Theory core | ✅ Done (2026-07-15) |
| 2 — MIDI layer | ✅ Done (2026-07-15) — hardware key-press check pending |
| 3 — Walking skeleton (Milestone A) | ✅ Done (2026-07-15) — hardware pass pending |
| 4 — Attempt lifecycle & hints | ✅ Done (2026-07-16) — stall-feel tuning on hardware pending |
| 5 — Presets & weighted generation | ⬜ Next |
| 6 — Storage & stats (Milestone B) | ⬜ |
| 7 — Session modes, goals & history | ⬜ |
| 8 — Notation & audio | ⬜ |
| 9 — Editors & import/export | ⬜ |
| 10 — Polish, a11y & deploy (Milestone C) | ⬜ |

---

## 2026-07-16 — Phase 4: Attempt lifecycle & progressive hints ✅

The full §6.2 state machine and §6.4 hint escalation, with 50 new tests
(147 total) and a 12-check browser-driven pass.

**Modules:**

- `practice/lifecycle.ts` — `AttemptLifecycle`, the explicit §6.2 machine
  (`idle → awaiting-release → armed → missed/advancing`), pure TS with
  injected `settings()/now()/onState/onAdvance` host. Misses latch via
  definitive-unsatisfiability (immediate) or the stall timer (full-sized,
  unchanged, non-matching held set); any held-set change restarts the stall
  clock; sets smaller than the chord never stall. Release-all before judgment
  abandons silently (no hint-stage advance); release-all after a miss re-arms
  the same prompt. Skip advances without judging.
- `practice/hints.ts` — `computeHint` (§6.4): misses 1–2 mark wrong held keys,
  or name the failed constraint as text when every key is a chord tone
  ("Bass must be the 3rd", "Missing the 5th", "Span too narrow", "Octave
  doubling not allowed" — ordered so guidance is never misleading: doubling
  before missing tones before bass before span); miss 3+ reveals the prompt's
  `example` voicing.
- `practice/settings.ts` — `PracticeSettings` (the two §6.3 matcher toggles +
  judgment delay 500 ms + auto-advance 800 ms) with `sanitizeSettings`
  (defaults for junk, delays clamped to 0–10 000 ms).
- `store/settingsStore.ts` — settings + `update()`, persisted to a plain
  `playingchord:settings` localStorage key (migrates in Phase 6).
- `store/practiceStore.ts` — rewritten as a thin adapter: picks prompts,
  forwards held-set changes, mirrors machine state; all judging logic now
  lives in `practice/`.
- UI: `PromptCard` gains the ✘ feedback/hint line (fixed-height, color always
  paired with the ✔/✘ icon) and the Skip button; `KeyboardView` gains the
  overlays — wrong keys rose + ✕, revealed keys sky + hollow ring, held stays
  emerald + filled dot (shape + color everywhere, §6.4); new `SettingsPanel`
  popover in the header for the four Phase 4 settings.

**Tests of note:** `lifecycle.test.ts` covers every §6.2 transition — held-over
notes, self-correction abandon (including a pending-stall cancel), stall on
wrong inversion, stall-clock restart, notes-during-advance-window ignored,
skip-cancels-stall, hint escalation 1→2→3, live settings reads, reaction time
spanning retries. `hints.test.ts` pins each constraint text and the
strict-off/doubling-off interactions.

**Verified in headless Edge (sim MIDI, QWERTY):** wrong key → immediate ✘ with
the key marked ✕; hint persists through release and retry; correct on retry →
✔ + auto-advance; 3 misses → example voicing ringed on the keyboard, cleared
on correct; skip advances instantly; stalled all-chord-tone attempt shows
"Missing the 5th"; settings edits persist to localStorage. Screenshots match
the §7 sketch.

**Notes / deviations:**

- PLAN.md only required settings to be in-store; added the minimal header
  settings panel anyway since stall-feel tuning (Risks) needs a reachable knob
  at the piano.
- Interpretation: hints persist while re-arming/retrying (not just during the
  latched miss) and clear on correct/advance; wrong-key marks stay on the
  marked notes through the retry as "don't press these" guidance.
- Stall-timer feel (500 ms default) still needs real-hardware validation —
  same pending hardware session as Phases 2–3.

**Next:** Phase 5 — presets & weighted generation: `ChordPool` expansion, all
7 built-in presets + picker, weighted pick over an in-memory stats stub.

## 2026-07-15 — Phase 3: Walking skeleton (Milestone A) ✅

The first playable loop: hardcoded major-triads preset (`any` rule, name-only
prompt), judged on real held-note changes, with 21 new tests (97 total) and a
browser-driven end-to-end pass.

**Modules:**

- `practice/combos.ts` — `Combo` `(root, typeId, voicingId)` + `comboKey`;
  `MAJOR_TRIADS_COMBOS` as the Phase 3 hardcoded pool (real presets: Phase 5)
- `practice/generator.ts` — `pickCombo`: uniform random with no-immediate-
  repeat (last `min(3, poolSize−1)`, §5); rng injectable. Weighted pick
  replaces the uniform draw in Phase 5.
- `practice/prompts.ts` — `Prompt` (§3.4) built from a combo; throws on
  unsatisfiable combos (kept out of pools by §4 preset validation later)
- `store/practiceStore.ts` — correct-path-only skeleton of the §6.2
  lifecycle: `awaiting-release → armed → advancing`. Arms only when all keys
  are released (held-over notes never judge the next prompt); judges every
  held-set change; ✔ + reaction time (prompt-shown → correct, §7); auto-
  advance after 800 ms with input ignored during the window. Full state
  machine with miss/stall/hints/skip replaces this in Phase 4.
- `components/PromptCard.tsx` — big chord name, voicing label (omitted for
  `any`), fixed-height feedback line; `components/KeyboardView.tsx` — 3-octave
  C3–C6 keyboard, held keys in color + dot marker (no overlays yet)
- `App.tsx` — practice view replacing the Phase 2 debug view; wires
  `midiStore.heldNotes` → `practiceStore.onHeldChange` (stores stay decoupled)

**Verified in headless Edge (sim MIDI, QWERTY):** prompt renders; playing the
triad flashes ✔ with reaction time and auto-advances; flash clears; held-over
notes never judge the next prompt until release+replay; wrong clusters do
nothing; keyboard chips track press/release; no immediate repeats across
rounds. Screenshot matches the §7 sketch (name-first, keyboard bottom).

**Notes / deviations:**

- None from PLAN.md scope. Fixed a subtle generator bug found by tests:
  `slice(-0)` returns the whole array, so a 1-combo pool excluded itself.
- Milestone A's "sit at the piano" check still needs the user at real
  hardware (same pending item as Phase 2's key-press check).

**Next:** Phase 4 — attempt lifecycle & hints: the full §6.2 state machine in
`practice/` (miss/stall/retry/skip), §6.4 progressive hints, settings.

## 2026-07-15 — Phase 2: MIDI layer ✅

`src/midi/` + the MIDI Zustand store, with 21 new tests (76 total) and a
browser-driven verification pass.

**Modules:**

- `midi/types.ts` — `MidiSource` contract (init/devices/setActiveDevice/
  subscribe); note events only flow for the active device
- `midi/webMidiSource.ts` — Web MIDI implementation; handlers attached to all
  inputs, filtered by active id (unplug/replug replaces `MIDIInput` instances)
- `midi/simulatedMidiSource.ts` — programmatic source for tests/dev;
  `midi/devKeyboard.ts` — dev-only QWERTY playing (`?midi=sim`, A=C4…P=D♯5)
- `midi/parseMessage.ts` — raw message → note event (any channel; vel-0
  note-on = note-off; CC/pitch-bend/aftertouch ignored)
- `store/midiStore.ts` — support status, device list, active device, held-note
  set. Auto-select on hot-plug: remembered id → remembered *name* (ids are
  unstable across sessions) → first device. Held notes cleared on any device
  switch. Last device in a plain localStorage key (migrates in Phase 6).
- `components/MidiGate.tsx` — blocking screens (§2 unsupported, denied,
  §6.1 connect-a-keyboard w/ hot-plug resume); `components/DevicePicker.tsx`
- `App.tsx` — throwaway MIDI debug view (device + held-note chips),
  replaced in Phase 3

**Verified in headless Edge (playwright-core, system channel):** sim-mode
chord press/release renders correct chips (C4/E4/G4), unmapped keys ignored;
unsupported and denied blocking screens render; real Web MIDI path enumerated
and auto-selected an actual device ("SMC-PADPocket-Bt"). Recipe persisted in
`.claude/skills/verify/SKILL.md`.

**Notes / deviations:**

- Chromium/Edge now gates Web MIDI behind the sysex-level permission — in
  Playwright, `grantPermissions(['midi'])` alone still rejects; need
  `['midi', 'midi-sysex']`. Real browsers just show one prompt.
- Physical key-press check (done-when criterion) still needs the user at the
  hardware; everything else about hot-plug/reconciliation is unit-tested.

**Next:** Phase 3 — walking skeleton (Milestone A): hardcoded major-triads
preset, name prompt, correct-path judging, arm-on-release, auto-advance.

## 2026-07-15 — Phase 1: Theory core ✅

All of `src/theory/` implemented as pure TS (no DOM/MIDI) with 55 unit tests
across 4 suites; lint/typecheck/build green.

**Modules:**

- `notes.ts` — `PitchClass`, `MIDDLE_C`, `pitchClass()` (DESIGN.md §3.1)
- `chordTypes.ts` — all 19 built-in `ChordType`s as data; each interval
  carries `{ semitones, degree }` so spelling can derive ♯5 vs ♭6 (§3.2, §3.5).
  `Chord`, `chordPitchClasses()`, `chordToneAt()` (bass-constraint lookup).
- `voicingRules.ts` — `VoicingRule` model + the 6 built-in rules (§3.3)
- `matcher.ts` — `matches()` per §6.3 (doubling exact/allowed, strict extra
  notes, bass, span; settings override forces exact) and
  `isDefinitivelyUnsatisfiable()` per §6.2 (exactly the three definitive
  conditions; wrong-bass/unmet-span-min left to the stall timer)
- `realize.ts` — `realizeVoicing()`: deterministic compact-above-bass seed,
  octave-raise widening for span minimums, whole-octave centering near middle
  C; validates its own output via the matcher, `null` if unsatisfiable
- `spelling.ts` — default root policy (C C♯ D E♭ …), degree-based chord-tone
  spelling (third of B maj = D♯; A♭ dim7 → E♭♭/G♭♭), letter-based octaves
  (C♭4 = MIDI 59), `spellVoicing()` for the staff, `chordDisplayName()`

**Tests of note:** realize property test covers all 19 types × 6 rules × 12
roots (1,368 combos: non-null, matches its own rule, sorted, 88-key range,
deterministic); matcher covers sus2≡sus4 and dim7/aug symmetry, the
open-rule doubling rationale, and every §6.2 definitive/non-definitive case.
Phase 0's placeholder smoke test removed.

**Deviations:** none from DESIGN.md. Noted: `closed` (span ≤ 11) is
technically satisfiable by 5+-tone extended chords as one-octave clusters, so
the §4 editor warning example may need a nuance when Phase 9 lands.

**Commit:** see `git log` (Phase 1 commit).

**Next:** Phase 2 — MIDI layer (`src/midi/`): Web MIDI wrapper + simulated
source, device management, held-note store, blocking screens, debug view.

## 2026-07-15 — Phase 0: Scaffolding ✅

Repo initialized and project scaffolded; all Phase 0 exit criteria verified
(`npm run dev` serves the app, `npm test` passes, `npm run build` succeeds).

**Toolchain** (Node 24, npm 11):

- Vite 8 + React 19 + TypeScript 6 (create-vite `react-ts` template)
- Tailwind CSS 4 via the `@tailwindcss/vite` plugin
- Zustand 5 (state), Vitest 4 (tests, integrated in `vite.config.ts`)
- oxlint (linting) + Prettier (formatting)
- GitHub Actions CI: lint → format check → test → build (activates once a
  GitHub remote is added)

**Deviations / notes vs. PLAN.md:**

- **oxlint instead of ESLint** — the current create-vite template ships oxlint;
  kept it (plan allowed "ESLint + Prettier (or Biome)"-class tooling).
- **`strict` added manually** — the template no longer sets `"strict": true`;
  added it plus `noUncheckedIndexedAccess` to both tsconfigs.
- **Prettier ignores `*.md`** — DESIGN.md/PLAN.md stay hand-formatted.
- **`.gitattributes` forces LF** — avoids CRLF churn on Windows.

**Layout:** `src/{midi, theory, practice, storage, audio, components, store}/`
per DESIGN.md §8, each with a placeholder `index.ts` referencing its design
section. Placeholder `App.tsx` hello page confirms the Tailwind pipeline.

**Commits:**

- `8432cab` — Add design document and build plan
- `9f4a378` — Phase 0: scaffold Vite + React + TS project

**Next:** Phase 1 — theory core (`ChordType` table, voicing rules, matcher,
`realizeVoicing`, spelling) as pure, unit-tested TS.
