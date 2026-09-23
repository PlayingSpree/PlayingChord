# Scale practice — build plan

Build plan for spec **10.0.0** (scales). The *what* and *why* live in
[DESIGN.md](DESIGN.md) — §3.6, §4, §5, §6.3, §6.6, §7, §8, §9 #4 — and the summary in
[CHANGELOG.md](CHANGELOG.md). This file is only the *order* of the work; delete it
when the last step lands, as PLAN.md/PROGRESS.md were.

**Branch:** `scales`. The 10.0.0 spec is committed there ahead of the code, so DESIGN.md
on that branch describes the target, not the app. The branch merges to `dev` only when
the steps below are done — `dev`'s DESIGN.md keeps describing the app as it is.

Each step ends green on `npm run lint`, `npm run format:check`, `npm test`,
`npm run build`. The chord app must keep working after every step: nothing a chord
user can see changes until step 6.

---

## 1. Scale theory (`src/theory/`)

- `scaleTypes.ts` — `major`, `natural-minor`, `harmonic-minor`, `melodic-minor`
  (ascending): id, name, intervals with degrees, fingering (§3.6).
- **Fingering data** — research the ABRSM-standard fingering per root × scale type ×
  hand, for 1/2/3 octaves (the multi-octave ones follow the crossing pattern).
  Minor forms that differ from natural minor get their own entry. Cite the source
  in a comment. None for `block`.
- Shapes library — `up-1`, `updown-1`, `up-2`, `updown-2`, `up-3`, `updown-3`,
  `block`, each with its note count and grade multiplier (2, 4, 4, 7, 6, 11, 2).
- Scale spelling — by degree, each letter once, double sharps allowed (G♯ harmonic
  minor → F𝄪). Root choice: major uses the existing major-key rule; minor uses the
  fewest-accidental minor key (C♯ F♯ G♯ E♭ B♭ minor). Key signature for minor =
  relative major's; raised 6/7 as accidentals.
- Realize a run: the full MIDI sequence from a root near middle C (up-and-down plays
  the top once); for `block`, the one octave.
- Tests: intervals, spelling of all 48 scales (no repeated letters), run lengths match
  the shapes table, fingering present for every root × type × hand.

## 2. Shared plumbing (`src/practice/`)

- `Combo` → union over `kind` (`chord` | `scale`); `comboKey` for scales =
  `s:<root>:<scaleType>:<shape>`; chord keys byte-identical to today. `parseComboKey`
  handles both, returns null for stale scale keys.
- `Prompt` → union over `kind`; `createPrompt` / `comboLabel` for scales (shape label
  omitted for `up-1`).
- Presets: a `kind`; scale pool = roots × scale types; shape ids in place of voicing
  ids; `expandPreset` yields scale combos. Missing kind = chord.
- Built-in scale presets 8–15 (§4).
- Unlock order: scale presets always by accidental count (major C G F D B♭ A E♭ E A♭
  B D♭ F♯; minor A E D B G F♯ C C♯ F G♯ B♭ E♭), ignoring the circle-of-fifths setting.
- Audit the ~17 files that read chord fields directly (`.typeId`, `.voicingId`,
  `prompt.chord`) — narrow on `kind`. Song stays chord-only.
- Tests: key round-trip, old chord keys unchanged, expansion, unlock order.

## 3. Grading (`src/practice/stats.ts` and callers)

- Per-combo grade multiplier: the speed ramp's cut points and the 10 s ceiling scale
  by the shape's multiplier (chords ×1).
- Clamp in the recording path uses the scaled ceiling; `10.0s+` readout scales.
- Slow / fast chips: D and A seconds × multiplier.
- Session grade: divide each scale prompt's time by its multiplier before averaging;
  the Avg-time card stays plain seconds.
- Tests: `up-1` grades S ≤ 2 s … D ≤ 10 s; ceiling 20 s; chord grades unchanged.

## 4. Judging

- **Run lifecycle** (new, pure TS, fake-timer tests like `lifecycle.ts`), emitting the
  same `LifecycleState`:
  - note-on input only; first note must be the root (any octave), fixes the octave;
  - each next note-on must be the exact next MIDI note; wrong → miss, run waits on
    the expected note; repeated wrong notes at one position = one miss;
  - exact starting note replayed mid-run → restart from the top, no miss, clock runs;
  - correct on the last note; advance window and scaled ceiling as §6.2; no stall;
  - the Ready-gate note isn't the run's first note.
- **Block** via the existing lifecycle: all scale pitch classes once, root lowest,
  optional top root, span ≤ 12; doubling / strict-extra settings don't apply.
- Hints: per-position misses 1–2 mark the wrong key, 3+ reveals the rest of the run;
  progress (correct notes so far) always; Learn marks the next key.
- The store picks the machine from the prompt's kind + shape, not the mode.

## 5. Persistence (`src/storage/`)

- Preset `kind` (absent → chord), incl. import/export.
- Daily record: existing counters are chord-only; optional `scales` bucket with the
  same four counters (absent → zero). Active minutes stay shared.
- Settings: switched-to side; active preset per side (existing → chord side); best
  combo streak per side (existing → chord side).
- No schema migration — every addition reads a sensible default when absent. Tests
  load a pre-10.0.0 state and see chords-only.

## 6. Screens (`src/components/`, `src/store/`)

- Home: **Chords | Scales** segmented switch above the Continue card (persisted);
  picker, Continue card, In play, mode row per side (no Song on Scales); Daily locked
  per side; Progress button accuracy per side.
- Session sheet: side's presets only; no Song on Scales.
- Daily: pool from the side's presets.
- Stage, scale prompt: name + *scale* tag, shape label, fingering line
  (`RH … · LH …`, none for block), staff one-octave ascending treble line near
  middle C, keyboard run progress / Learn next-key / miss-3 rest-of-run, keyboard
  widens for 3-octave shapes (no folding).
- Report: baselines and Total prompts per side; Total time shared.
- Progress: *Chord progress* / *Scale progress*; header streak/time/days shared,
  total prompts + everything below per side; chord stats per side.
- Settings: preset editor lists both kinds under two headings; new preset picks kind;
  scale editor = roots × scale types × shapes.
- UI copy says *scale* wherever it says *chord* on the Scales side.
- Verify in the browser (`verify` skill, `?midi=sim`).

## 7. Dev simulator (`src/midi/`)

- Extend the `?midi=sim` QWERTY map (A=C4…) so 2–3 octave runs are playable, or add
  an octave-shift key.

---

**Finishing:** when step 7 lands, delete this file, confirm DESIGN.md still matches
what was built (patch it if the build taught anything), and merge `scales` → `dev`.
