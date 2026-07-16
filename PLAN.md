# PlayingChord — Build Plan

Implementation sequencing for the app specified in [DESIGN.md](DESIGN.md) (Draft v4).
This document covers *what to build in what order and how to verify it* — all product
decisions live in the design doc and are referenced by section (§) here.

**Strategy in one paragraph:** build the pure-logic core first (it's the hardest part to
get right and the easiest to test), get a playable vertical slice on real hardware as
early as possible (Milestone A), then layer on the practice-engine details, persistence,
modes, notation, and editors. Every phase ends with something runnable and tested;
VexFlow and the settings editors come late because staff-off / built-in-presets-only is
explicitly a first-class way to use the app.

---

## Phase overview

| # | Phase | Depends on | Milestone |
|---|-------|-----------|-----------|
| 0 | Scaffolding | — | `npm run dev` + passing CI checks |
| 1 | Theory core (pure TS) | 0 | Matcher fully unit-tested |
| 2 | MIDI layer | 0 | Held notes visible from real keyboard |
| 3 | Walking skeleton | 1, 2 | **A: playable practice loop** |
| 4 | Attempt lifecycle & hints | 3 | Full §6.2/§6.4 behavior |
| 5 | Presets & weighted generation | 1 | All built-in presets drillable |
| 6 | Storage & stats | 4, 5 | **B: stats persist across reloads** |
| 7 | Session modes, goals & history | 6 | Learn/Practice modes, streaks, History tab |
| 8 | Notation & audio | 3 | Grand staff + correct chime |
| 9 | Editors & import/export | 5, 6 | Custom presets/voicings round-trip |
| 10 | Polish, a11y & deploy | all | **C: shipped static site** |

Phases 5 and 8 are independent of 4 and can be parallelized or reordered if needed;
everything else is a real dependency chain.

---

## Phase 0 — Scaffolding

Goal: a repeatable dev environment matching §2.

- `git init`; commit DESIGN.md and this plan.
- Vite + React + TypeScript project; Tailwind CSS; Zustand; Vitest.
- ESLint + Prettier (or Biome), strict `tsconfig`.
- Create the §8 directory skeleton (`midi/`, `theory/`, `practice/`, `storage/`,
  `audio/`, `components/`, `store/`) with placeholder index files so import paths are
  settled early.
- `npm run dev`, `npm test`, `npm run build` all work; optional GitHub Actions running
  lint + test + build.

**Done when:** a fresh clone installs, tests pass (one trivial test), app serves a
"hello" page.

## Phase 1 — Theory core (pure TS, no DOM/MIDI)

Goal: everything in `theory/` (§3) complete and unit-tested. This is the highest-risk
logic and needs no hardware, so it goes first and gets TDD treatment.

- Note model: MIDI numbers, `PitchClass`, helpers (§3.1).
- `ChordType` table with all 19 built-in types, including per-interval **degree** info
  needed by spelling (§3.2, §3.5).
- `VoicingRule` model + the 6 built-in rules (§3.3).
- **Matcher** `matches(heldNotes, chord, rule, settings)` implementing §6.3 exactly:
  doubling `exact`/`allowed`, strict-extra-notes toggle, bass constraint, span.
  Also expose `isDefinitivelyUnsatisfiable(held, chord, rule, settings)` — Phase 4's
  miss detection (§6.2) needs it, and it's pure theory logic.
- `realizeVoicing(chord, rule) → number[]` — deterministic example voicing near middle C
  (§3.4). Property-test: its output always satisfies its own rule, for every
  (chord type × built-in rule) combo that is satisfiable.
- Spelling module: root policy + chord-tone spelling from degrees (§3.5). Test the known
  traps: third of B major is D♯; ♯5 of C aug is G♯ not A♭.
- Edge cases as explicit tests: sus2/sus4 pitch-class identity, symmetric dim7/aug
  (§3.2), `open` rule requiring exact doubling, 5+-tone chords vs `closed` span.

**Done when:** matcher/realizer/spelling have exhaustive unit tests; no UI yet.

## Phase 2 — MIDI layer

Goal: `midi/` wrapper (§6.1) working with real hardware and fully fakeable.

- Wrapper interface (`MidiSource`) with two implementations: Web MIDI and a
  simulated source for dev/tests (keyboard-triggered or programmatic).
- Device enumeration, hot-plug connect/disconnect events, device picker state,
  last-device persistence (plain key in `localStorage` for now; migrates into the
  Phase 6 schema later).
- Note-on/note-off → reactive held-note `Set<number>` in the Zustand store.
- Capability + no-device detection driving two blocking screens: "Web MIDI not
  supported" (§2) and "connect a MIDI keyboard" with hot-plug auto-resume (§6.1).
- Throwaway debug view: list devices, render currently held note numbers.

**Done when:** pressing keys on the physical keyboard updates the debug view live;
unplugging mid-session shows the blocking screen and replugging resumes.

## Phase 3 — Walking skeleton  → **Milestone A**

Goal: the smallest *playable* loop, on real hardware, wiring Phases 1+2 together.
Deliberately thin: one hardcoded preset (major triads, `any` rule), name-only prompt.

- Practice store: current prompt, judge on every held-set change, **correct-path only**
  (✔ flash + auto-advance after 800 ms; wrong input does nothing yet).
- Arm-on-all-keys-released so held-over notes never judge the next prompt (§6.2 step 1 —
  this is core to the loop feeling right, so it lands here, not in Phase 4).
- Random pick with no-immediate-repeat (last `min(3, poolSize−1)`, §5) — uniform
  weighting for now.
- Minimal UI: big chord name, correct flash + reaction time, on-screen keyboard
  (~3 octaves) showing held notes live (no overlays yet).

**Milestone A — done when:** you can sit at the piano and drill random major triads
end-to-end. This is the first point where the app is *useful*; everything after
improves it.

## Phase 4 — Attempt lifecycle & progressive hints

Goal: the full §6.2 state machine and §6.4 hint escalation.

- Model the lifecycle as an explicit state machine in `practice/` (pure, unit-tested
  with simulated note events + fake timers): armed → evaluating → correct / miss →
  retry; silent abandon on release-before-judgment; skip.
- Miss detection: definitive-unsatisfiability (from Phase 1) + the **stall timer**
  (default 500 ms, configurable). Stall tuning is a known risk — see Risks.
- Retry-until-correct with per-prompt hint stage counter: misses 1–2 mark wrong keys
  (or name the failed constraint as text when all played keys are chord tones);
  miss 3+ overlays the `example` voicing on the keyboard (§6.4). Color **and**
  shape/icon everywhere.
- Skip button — advances, excluded from stats/weighting (§6.2 step 4).
- Settings (in-store, plain persistence for now): strict extra notes, allow octave
  doubling, judgment delay, auto-advance delay.

**Done when:** state-machine tests cover every §6.2 transition, including: held-over
notes, self-correction abandon, stall on wrong inversion, notes-during-advance-window
ignored.

## Phase 5 — Presets & weighted generation

Goal: all of §4 and §5 except persistence of custom presets (Phase 9 covers editing).

- `ChordPool` variants (product / explicit / diatonic) + pool → combo expansion
  keyed `(root, typeId, voicingId)` (§5).
- All 7 built-in presets, including diatonic-in-a-key (needs key picker) and inversion
  drills; preset picker in the top bar.
- Weighted pick: recent-miss rate ↑ weight, uniform baseline for no-history combos
  (§5). Feed it an in-memory stats stub until Phase 6 supplies real history.
- "Practicing: missed recently" indicator on weighted prompts (§7).
- Voicing label in the prompt area ("2nd inversion"; omitted for `any`).

**Done when:** every built-in preset generates correct combos (unit-tested expansion,
incl. diatonic spelling of roots from the key), and weighting is unit-tested against a
synthetic miss history.

## Phase 6 — Storage & stats  → **Milestone B**

Goal: `storage/` (§8) — versioned localStorage persistence — plus live session stats.

- Versioned schema with a migration hook from day one (v1). Persist: settings,
  last device, per-combo stat records (attempts, first-try successes, recent-miss
  window, time-to-correct samples), daily records (date, active minutes, prompts,
  first-try successes).
- Wire real per-combo stats into the Phase 5 weighting (replace the stub).
- Live session stats bar: prompts, first-try accuracy, avg time-to-correct, worst
  chords — using the §7 definitions (skips excluded; time-to-correct includes retries).
- Storage module is pure TS (serialize/deserialize/migrate unit-tested); only a thin
  adapter touches `localStorage`.

**Milestone B — done when:** miss a chord repeatedly, reload the browser, and see it
both up-weighted in generation and listed under "worst chords".

## Phase 7 — Session modes, goals & history

Goal: §7's modes, goals/streaks, and the History tab.

- Mode picker: **Learn** (example voicing highlighted on the on-screen keyboard from
  the start — the staff joins in Phase 8; untimed; attempts excluded from stats and
  weighting, active minutes still count) and **Practice** (default: voicing hidden,
  hints per §6.4). Practice-mode settings next to the picker: **timer**
  (off/5/10/15/custom, countdown in UI, end-of-session summary: prompts, accuracy,
  slowest/worst chords) and **worst chords only** (draws only from the selected
  preset's worst combos).
- Active-minutes tracking (define "active" as e.g. attempts occurring within a rolling
  idle window — document the chosen rule in code) feeding the daily goal (default
  10 min, configurable) and streak (consecutive local-timezone days meeting goal).
  Streak/goal chip in the top bar.
- History view: accuracy trend, time-to-correct trend, most-improved/worst chords,
  streak calendar + goal history. Reachable from the top bar independent of practice.
- Goal/streak day-rollover logic is pure and unit-tested (timezone, DST, gap days).

**Done when:** Learn mode shows the example keys and records no stats; a timed Practice
session produces a summary; practicing past the goal increments the streak; History
renders trends from persisted daily/combo records.

## Phase 8 — Notation & audio

Goal: the two optional feedback channels — kept late deliberately since name-only /
silent practice is first-class (§3.4, §9).

- VexFlow grand-staff component rendering the prompt's `example` voicing in Learn mode,
  using the Phase 1 spelling module; staff on/off setting (Learn's keyboard highlight
  stays regardless); hint stage 3 also highlights expected notes on the staff when
  shown (§6.4).
- `audio/` Web Audio wrapper: correct chime only, on/off toggle, default on. No miss
  sound exists (§9). Instantiate the AudioContext on first user gesture (browser
  autoplay policy).

**Done when:** staff renders correct spellings for awkward roots (F♯ maj7, A♭ min,
B dom9 across both staves) and the chime plays on correct without adding latency to
the ✔ flash.

## Phase 9 — Editors & import/export

Goal: user-defined content (§4, §7 settings screens).

- Voicing builder: compose bass/span/doubling into a named `VoicingRule`, saved to the
  shared library, usable in any preset.
- Preset editor: create/edit/delete custom presets (pool + voicing refs) with
  rule-compatibility validation warnings (e.g. dom13 vs `closed`, §4).
- Import/export: presets + the custom voicing rules they depend on as JSON; import
  validates against the schema version and reports conflicts (id collisions).
- Full settings screen consolidating all toggles/delays/durations/goal minutes (§7).

**Done when:** export from one browser profile, import in a fresh one, and the custom
preset drills identically.

## Phase 10 — Polish, accessibility & deploy  → **Milestone C**

- Accessibility pass: verify every overlay/feedback state uses shape/icon + color
  (§6.4), keyboard-navigable settings, prompt name readable from a distance.
- Cross-browser check per §2 (Chrome/Edge/Opera; Firefox permission flow) and the
  blocking message on Safari.
- Layout polish per the §7 sketch; empty states (fresh install, empty history).
- Static deploy (GitHub Pages or Netlify) + README with browser requirements.

**Milestone C — done when:** the deployed URL works with a real MIDI keyboard on a
machine that never ran the dev build.

---

## Testing strategy

- **Unit (Vitest), the bulk:** `theory/`, `practice/`, `storage/` are pure TS with no
  DOM/MIDI (§8) — matcher tables, realizer property tests, lifecycle state machine with
  fake timers, weighting distributions, schema migrations, streak rollover.
- **Component:** keyboard overlays per hint stage, blocking screens, summary rendering.
- **Manual hardware script (per milestone):** a short checklist run with the real
  keyboard — held-over notes, hot-unplug/replug, sustain-pedal noise if the device
  sends CC, fast repeated correct answers during the advance window.

## Risks & mitigations

- **Stall-timer feel (§6.2):** 500 ms may misfire on slow rolled chords or feel laggy
  on decisive wrong answers. Mitigation: it's configurable from Phase 4, and the
  lifecycle is a pure state machine so thresholds are cheap to tune; validate on real
  hardware at Milestone A+.
- **Web MIDI quirks:** device IDs unstable across sessions on some OSes; hot-plug
  events flaky in Firefox. Mitigation: match remembered device by name as fallback;
  hardware checklist covers replug.
- **VexFlow grand-staff complexity:** cross-staff voicings and accidentals are fiddly.
  Mitigation: staff is reference-only and late (Phase 8); worst case ship name-only
  first — the design explicitly allows it.
- **`localStorage` schema churn:** stats formats tend to evolve. Mitigation: versioned
  schema + migration hook from the first persisted byte (Phase 6).
- **Active-minutes definition (§7):** "practice time" needs an idle rule or streaks
  feel unfair/gameable. Mitigation: pick a simple documented rule in Phase 7; it's
  pure logic and easy to adjust.
