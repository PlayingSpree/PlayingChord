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
| 5 — Presets & weighted generation | ✅ Done (2026-07-16) |
| 6 — Storage & stats (Milestone B) | ✅ Done (2026-07-16) |
| 7 — Session modes, goals & history | ✅ Done (2026-07-16) |
| 8 — Notation & audio | ⬜ Skipped for now (user call, 2026-07-16) |
| 9 — Editors & import/export | ✅ Done (2026-07-16) |
| 10 — Polish, a11y & deploy (Milestone C) | ⬜ Next |

---

## 2026-07-16 — Phase 9: Editors & import/export ✅ (Phase 8 skipped)

The §4/§7 custom-content layer: voicing builder, preset editor with
rule-compatibility warnings, JSON import/export, and the full settings
screen. Built directly after Phase 7 — **Phase 8 (notation & audio) was
skipped on the user's instruction** and remains open. 33 new tests (331
total) and a 25-check browser-driven pass including the phase milestone
(export from one browser profile, import in a fresh one, drill identically).

**Modules:**

- `theory/voicingRules.ts` — `VoicingLibrary`/`voicingLibrary(custom)`: one
  lookup over built-ins + user rules (built-ins win an id collision).
  Everything that resolves a voicingId — `createPrompt`, `comboLabel`,
  `parseComboKey`, `expandPreset` — now takes an optional library and
  defaults to built-ins-only, so custom rules work everywhere without
  touching matcher code (§3.3's promise).
- `practice/presets.ts` — `expandPreset` drops combos whose rule is missing
  or unsatisfiable (checked once per type × rule; root-independent). A saved
  preset with some warned pairings still drills its playable part.
- `practice/library.ts` — `newLibraryId` (prefixed + random so two profiles'
  same-named content can't collide on import), `presetWarnings` (§4:
  `missing-rule` / `unsatisfiable` / `cluster-only` — the Phase 1 note about
  `closed` being technically satisfiable by 5+-tone chords became its own
  warning kind), and the rule display helpers.
- `storage/schema.ts` — `customVoicingRules` + `customPresets` slices with
  sanitizers (garbled entries dropped whole; ids may never shadow built-ins;
  names trimmed/capped at 60; span within 0–87 and non-contradictory; preset
  voicing refs filtered to known rules, presets with none left dropped).
  Added within v1 like `timeToCorrectMs` — no version bump, no migration.
- `storage/importExport.ts` — `exportLibraryJson` (whole custom library — a
  superset of "presets + the rules they depend on") and `planImport`:
  validates kind/schema-version (newer → refused), sanitizes entries,
  reports id collisions as §4 conflicts. **Local content always wins**;
  identical incoming items are reported "already present", so re-import is
  idempotent.
- `store/libraryStore.ts` — persisted CRUD over both lists; save paths
  re-sanitize; `deleteRule` refuses while a custom preset references the
  rule (UI explains and lists the presets).
- `store/practiceStore.ts` — `voicings` dep beside `presets` (the app
  singleton folds `libraryStore` in; factory defaults stay pure built-ins so
  tests are isolated), empty-expansion fallback to the first preset, and
  `refreshLibrary()` — subscribed to every library change: re-resolves the
  list/expansion, falls back (and re-remembers) if the active preset
  vanished or lost all combos, redeals a live prompt so it can't reference
  deleted content.
- UI: `SettingsView` (a third top-level view beside practice/History)
  consolidating the §7 settings screen — matcher toggles, delays, daily
  goal, the two library sections with inline `VoicingBuilder`/`PresetEditor`
  forms, and import/export (file download / picker + result report).
  The Phase 4 `SettingsPanel` popover is gone. Editors validate live
  (problems block save, §4 warnings don't — only a zero-combo preset can't
  be saved). `HistoryView` resolves stat keys against the live library, so
  custom-rule combos label correctly and stale keys still parse to null.

**Tests of note:** library lookup + collision precedence; warning matrix
(triad × bass-on-7th unsatisfiable, dom13 × closed cluster-only, missing
rule reported once, dom13 × open silent); expansion filtering incl. the
all-unsatisfiable → empty case; schema sanitizer edges (shadowed ids,
contradictory spans, junk span fields kept non-fatal, refs to dropped rules
filtered); import round-trip, newer-version refusal, conflict-vs-identical
reporting, junk counting, preset-referencing-a-conflicting-rule stays valid;
store CRUD persistence through a reloaded AppStorage, delete-rule guard;
practice-store custom drilling (compact voicing misses a span-min rule, the
example satisfies it), deleted/emptied active-preset fallback with memory
re-save, paused refresh staying promptless; and the milestone as a unit
test: export → fresh profile → import → identical expansion + working
prompt.

**Verified in headless Edge (sim MIDI, QWERTY, 25 checks):** settings
screen renders all four sections with the consolidated knobs; builder
composes bass/span/doubling with a live summary and saves into the library
list; preset editor flags dom13 × Closed Position as cluster-only, counts
drillable combos, and saves; the custom preset drills — root-position
C-E-G stalls into "Bass must be…" while E-G-C5 flashes ✔; History labels
the custom combo; library + stats persist across a reload; export downloads
JSON; a **fresh browser profile** imports it (re-import reports "already
present") and the imported preset judges identically — the Phase 9
milestone at the browser surface.

**Notes / deviations:**

- Phase 8 skipped (user instruction), so the §7 settings screen omits the
  staff and chime toggles — those land with their features. PLAN.md's
  phase-overview note already allows this reordering (8 is independent).
- The full settings screen *replaces* the Phase 4 popover; the stall-tuning
  knobs remain reachable at the piano, one click deeper.
- Import conflict policy (DESIGN.md §4 only says "reports conflicts"):
  colliding ids are never applied — the local version wins, the report
  names the conflicts. Export always bundles the whole custom library.
- DESIGN.md §4 says the editor *warns* on incompatible pairings, so saving
  warned presets is allowed; the safety net is expansion-time filtering
  plus the practice store's empty-expansion fallback (crash-free even with
  hand-edited storage).
- All settings/editor field controls carry `aria-label`s (also groundwork
  for the Phase 10 a11y pass).

**Next:** Phase 8 (notation & audio — VexFlow Learn-mode staff + staff
toggle, correct chime + toggle, both slotting into the settings screen) or
Phase 10 (polish, a11y & deploy — Milestone C).

## 2026-07-16 — Phase 7: Session modes, goals & history ✅

The v5 §7 session layer: Learn/Practice modes, the Practice-mode session
timer with end-of-session summary, worst-chords-only drilling, active
minutes → daily goal/streak, and the History tab. 61 new tests (298 total)
and a 23-check browser-driven pass.

**Modules:**

- `practice/session.ts` — `SessionMode`, timer presets/sanitizer, and
  `summarizeSession` over per-prompt `SessionEvent`s: the §7 summary
  (prompts, first-try, slowest by avg time, worst by session accuracy —
  "worst" requires a miss, same stance as `rankWorstCombos`).
- `practice/activeTime.ts` — `ActiveTimeTracker`, the documented §7
  active-minutes rule: time accrues between held-note events ≤ 30 s apart;
  longer gaps contribute nothing. Counts any playing — Learn mode and
  noodling included (§5: Learn is stats-neutral but its time counts).
- `practice/stats.ts` — `rankMostImproved` (History): combos whose full
  recent window beats their lifetime miss rate, min 5 attempts.
  `rankWorstCombos` doubles as the worst-only drill pool (no limit).
- `practice/lifecycle.ts` — `stop()`: halt without advancing (History nav,
  timer expiry); kills stall/advance timers, keeps tracking held keys.
- `practice/combos.ts` — `parseComboKey`, validated against the built-in
  type/voicing tables so stale persisted keys can't crash History.
- `storage/goals.ts` — pure streak logic over daily records: noon-anchored
  date-key arithmetic (DST-safe), `computeStreak` (an unmet *today* doesn't
  break a yesterday-ending chain), `computeBestStreak`, `lastDateKeys`.
  Streaks are always derived against the *current* goal, never stored.
- `storage/persistedStats.ts` — daily records also accumulate
  `timeToCorrectMs` (History's per-day average; added within schema v1 —
  the sanitizer defaults it, so early-v1 states need no migration) and
  `PersistedDailyActivity`/`InMemoryDailyActivity` for active minutes.
- `practice/settings.ts` — `dailyGoalMinutes` (default 10, clamp 1–1440)
  rides `PracticeSettings`, so persistence/sanitizing came free.
- `store/practiceStore.ts` — mode state (Learn records nothing: combo
  stats, daily prompts, session tallies and summary log all skip; a pending
  ✔ counts under the *outgoing* mode's rules on switch), worst-only pick
  pool (falls back to the full pool while nothing qualifies), timer
  lifecycle (start resets the session; expiry records a pending ✔, stops
  the machine, freezes input behind the summary; dismiss starts fresh),
  active-time buffering (flushed at ≥ 5 s into the daily record + reactive
  goal/streak state), and `pause()` for the History view.
- UI: `ModeBar` (segmented Learn/Practice + timer select with custom
  minutes + worst-only toggle, disabled until something is missed),
  `GoalChip` (🔥 streak + today/goal), countdown chip beside Skip (§7
  sketch), `SessionSummaryModal`, `HistoryView` (stat row, 12-week goal
  calendar, 30-day accuracy/time column charts, most-improved/worst
  lists), Learn reveal on `KeyboardView` (same overlay as hint stage 3),
  daily-goal field in the settings panel, practice/history view switch.

**Tests of note:** streak rollover (DST spring/fall keys, leap year, gap
days, goal-change re-evaluation), active-time window edges (exact 30 s
counts, 30.001 s doesn't, clock skew), summary ranking, Learn-mode
neutrality incl. pending-✔ semantics both directions, worst-only pinning +
empty-pool fallback + Learn ignoring it, timer expiry racing an advance
window, input frozen during summary, store pause/resume, lifecycle stop.

**Verified in headless Edge (sim MIDI, QWERTY, 23 checks):** Practice
default with goal chip at 0/10; worst-only disabled until a miss then pins
generation to the missed combo; Learn hides the timer, shows the example
voicing before input, and completes prompts without touching comboStats,
daily prompts, or session tallies; 5-min timer counts down in the prompt
area and (fake clock) ends in a summary — 2 prompts, 50%, slowest/worst
lists — whose dismissal starts a fresh session; ~10 simulated active
minutes flip the chip to "✓ 10/10 min" with streak 1; History shows the
streak, worst chords, day columns and the goal-met calendar day; goal
progress survives a reload. Screenshots match the §7 sketch.

**Notes / deviations:**

- A "session" is still one app load, except starting a timer (or dismissing
  its summary) begins a fresh one — the §7 summary describes exactly the
  timed window, so the stats bar resets with it.
- Mode, worst-only and timer are deliberately not persisted: Practice is
  the designed default and Learn/review are per-sitting choices.
- Active time keeps accruing while the History view is open (playing is
  practicing, judged or not); prompts pause there via `pause()`.
- Switching mode/worst-only deals a fresh prompt immediately (a Learn
  reveal must not be answerable for Practice credit); switching to Learn
  silently cancels a running timer (Learn is untimed) — no summary.
- History's trend charts follow the dataviz-skill procedure: single-series
  day columns (mark colors validated against the slate-950 surface), days
  without prompts render as gaps rather than zeros, native tooltips per day.
- PLAN.md suggested attempt-based "active"; held-note events were chosen
  instead (finer, and Learn/free play legitimately count). Documented in
  `activeTime.ts`.

**Next:** Phase 8 — notation & audio: VexFlow grand staff for Learn mode
(spelling module already carries `rootSpelling`), staff on/off setting,
Web Audio correct chime with on/off toggle.

## 2026-07-16 — Design revision: Learn/Practice session modes (DESIGN.md v5)

Before starting Phase 7, session modes were redefined with the user. The old
endless/timed/review trio becomes two modes:

- **Learn** — the prompt's example voicing is visible from the start (keyboard
  highlight in Phase 7; grand staff joins in Phase 8), untimed, and
  stats-neutral: attempts feed neither accuracy nor weighting (like skips),
  but active minutes still count toward the daily goal.
- **Practice** (default) — voicing hidden, recall-based, endless by default.
  The former timed and review modes are now Practice-mode settings: an
  optional **session timer** (countdown + end-of-session summary) and a
  **worst chords only** toggle.

The two-mode split and settings-on-Practice shape are the user's; the
sub-decisions follow recommended defaults (flagged for veto): matching stays
rule-based in Learn mode (any voicing satisfying the rule counts), per-prompt
play stays retry-until-correct (no per-prompt clock), hint escalation
describes Practice (Learn's reveal is always-on, wrong-key marks still
shown), and the staff on/off setting now scopes to Learn mode.

Updated: DESIGN.md (v5 — key decisions, §1, §3.4, §5, §6.4, §7, §8) and
PLAN.md (overview table, Phases 7–8). No code changes; Phase 7 implements
this shape. The Phase 6 entry's "Next" line below predates this revision.

## 2026-07-16 — Phase 6: Storage & stats (Milestone B) ✅

Versioned localStorage persistence (§8) with per-combo and daily stat
records wired into the §5 weighting, plus the live §7 stats bar. 41 new
tests (237 total) and a 16-check browser-driven pass.

**Modules:**

- `storage/schema.ts` — `PersistedStateV1` (version, settings, last device,
  preset selection, `comboStats`, `dailyRecords`), `defaultState`, and
  per-slice sanitizers that coerce junk persisted data (garbled stat records
  are dropped whole — losing one combo only resets its weighting).
  `localDateKey` keys daily records by the user's local clock.
- `storage/migrate.ts` — the migration hook from the first persisted byte:
  version chain (v1 today), legacy Phase 2–5 plain keys
  (`playingchord:settings`/`lastMidiDevice`/`preset`) folded into a fresh v1
  on first load; unknown *newer* versions reset to defaults (downgrade of a
  static site — documented in code).
- `storage/appStorage.ts` — `AppStorage` over an injected `KeyValueStore`:
  loads+migrates once, serves reads from memory, writes through on update.
  Legacy keys are only removed after the versioned write succeeds.
- `storage/localStorageAdapter.ts` — the only file touching `localStorage`
  (all failures degrade to in-memory operation); exports the `appStorage`
  singleton the stores build their memory adapters on.
- `storage/persistedStats.ts` — `PersistedComboStats`, the persisted
  `ComboStatsSource`; each recorded outcome also ticks today's daily record
  (prompts, first-try successes; `activeMinutes` stays 0 until Phase 7).
- `practice/stats.ts` — the Phase 5 stub grew into the real record model:
  `ComboStatRecord` (attempts, first-try successes, recent-outcome window,
  time-to-correct samples capped at 20), pure `applyOutcome`/
  `recentHistoryOf`, `InMemoryComboStats` (tests), and `rankWorstCombos` —
  §7 "worst chords" ranked by recent-miss rate, then lifetime miss rate,
  then attempts; never-missed combos don't qualify. `comboLabel` (in
  `prompts.ts`) renders combo rows ("C maj — 1st Inversion").
- `store/practiceStore.ts` — records time-to-correct with each outcome,
  tracks session tallies (prompts / first-try / total time; skips excluded),
  and exposes `worstChords` for the active preset from persisted records.
  Settings/device/preset memories in all three stores are now
  appStorage-backed.
- UI: `StatsBar` between prompt and keyboard — session prompts, first-try
  accuracy, avg time-to-correct, and worst-chord chips with lifetime
  accuracy.

**Tests of note:** schema sanitizers (junk fields, impossible counts, window
caps, date-key self-healing); migration (legacy folding incl. partial junk,
newer-version reset, versioned-state-wins-over-legacy); `AppStorage` (legacy
keys kept when the versioned write fails, reload round-trip); Milestone B at
unit level (misses recorded through one storage instance drive weighting +
worst-chords through a fresh one); store-level session tallies (skips
untouched), worst-chords scoping to the active preset, pre-seeded stats
surfacing before anything is played.

**Verified in headless Edge (sim MIDI, QWERTY):** legacy plain keys migrate
into `playingchord:state` v1 (autoAdvance 900 kept, preset restored, legacy
keys removed); stats bar runs — → 1/100% → 2/50% with the missed combo
chipped at 0%; after miss-everything diatonic rounds + reload, session
tallies reset while worst chips persist, per-combo records and today's
daily record (9 prompts / 1 first-try) are in localStorage, and a
previously-missed combo reappears with the 🔥 indicator — Milestone B.

**Notes / deviations:**

- §7 calls the stats panel "live, session" but Milestone B requires worst
  chords to survive a reload — so worst-chords read the *persisted* records
  (scoped to the active preset, which review mode reuses in Phase 7) while
  prompts/accuracy/avg-time stay session-scoped. Session = one app load.
- Daily records are persisted from v1 but `activeMinutes` is always 0 —
  the active-minutes rule is Phase 7's; persisting the field now avoids a
  migration then.
- The practice-store test harness injects `InMemoryComboStats` by default so
  tests never share the module-level `appStorage` singleton.

**Next:** Phase 7 — session modes, goals & history: endless/timed/review
modes, active-minutes rule + daily goal/streak, History tab over the
persisted daily/combo records.

## 2026-07-16 — Phase 5: Presets & weighted generation ✅

All of §4/§5 except custom-preset editing (Phase 9): pool expansion, the 7
built-in presets with pickers, and miss-weighted generation over an in-memory
stats stub. 49 new tests (196 total) and a 16-check browser-driven pass.

**Modules:**

- `practice/presets.ts` — `ChordPool` (product / explicit / diatonic),
  `Preset`, `poolChords`/`expandPreset` (pool × voicingIds → combos), and
  `builtInPresets(diatonicKey)` returning all 7 §4 presets. Diatonic pools
  derive I ii iii IV V vi vii° from the major key and carry per-root
  `rootSpellings` so prompts spell from the key.
- `theory/spelling.ts` — key-aware spelling (§3.5): `spellMajorKeyTonic`
  (naming policy prefers the smaller signature: D♭ over C♯; F♯ kept, matching
  the default policy), `spellMajorScaleDegree` (3rd degree of B major = D♯,
  never E♭), `keyDisplayName`; `chordDisplayName` takes an optional root
  spelling. `Prompt` now carries `rootSpelling` for the Phase 8 staff.
- `practice/stats.ts` — `InMemoryRecentStats`, the Phase 5 stub: last 5
  outcomes per combo (`first-try`/`missed`), fed by real session results;
  Phase 6 swaps the backing store for persisted records behind the same
  `RecentStatsSource` interface.
- `practice/generator.ts` — `pickWeightedCombo` (§5): weight = 1 +
  3 × recent-miss-rate; no history (or a clean record) stays at the uniform
  baseline 1, so fresh presets behave uniform-random. No-immediate-repeat
  unchanged; `pickCombo` is now the weighted pick with no history.
- `store/practiceStore.ts` — preset/key selection state (`setPreset`,
  `setDiatonicKey`), weighted generation, and outcome recording on advance
  (skips never recorded, §6.2 step 4 — even after a miss). Selection persists
  to a plain `playingchord:preset` key (migrates in Phase 6). Exposes
  `missedRecently` for the indicator.
- UI: `PresetPicker` (preset select + major-key select shown only for the
  diatonic preset) replaces the hardcoded header label; `PromptCard` gains
  the fixed-height amber "🔥 Practicing: missed N× recently" line (§7).

**Tests of note:** built-in expansion counts (12/12/24/36/72/7/48) and
every combo of every preset satisfiable across all 12 diatonic keys; diatonic
spelling pinned for B major (D♯ min, A♯ dim) and D♭ major (G♭ maj); weighted
distribution against synthetic history (seeded rng, 4× combo lands ~4/7 of
draws); store-level outcome recording, indicator, preset switching (a correct
prompt still awaiting auto-advance is recorded; its dead timer never
double-advances), and junk-memory fallback.

**Verified in headless Edge (sim MIDI, QWERTY):** preset picker lists all 7;
seventh-chords prompt played end-to-end; diatonic key picker appears only for
diatonic, defaults to C, and B major spells sharps throughout; missing every
prompt then correcting makes reappearing combos show the 🔥 indicator (first
encounters never do); inversion drills show the voicing label and Skip
advances; preset + key survive a reload.

**Notes / deviations:**

- Inversion drills interpreted as maj+min triads × 12 roots ×
  {1st, 2nd inversion} (48 combos) — DESIGN.md §4 says only "a triad/root
  product".
- Indicator threshold: shown whenever the combo has ≥ 1 miss in its recent
  window (any up-weighting is flagged), with the count in the text.
- PLAN.md doesn't ask for preset-selection persistence; added the plain-key
  memory anyway (same pattern as device/settings) since re-picking a preset
  every session at the piano would grate.
- Preset↔rule compatibility *warnings* stay in Phase 9 with the editor; here
  a test asserts every built-in combo realizes.
- Removed Phase 3's `MAJOR_TRIADS_COMBOS`; the practice store's test seam is
  now a `presets` factory instead of a raw combo pool.

**Next:** Phase 6 — storage & stats (Milestone B): versioned localStorage
schema + migration hook, persisted per-combo/daily records wired into the
weighting, live session stats bar.

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
