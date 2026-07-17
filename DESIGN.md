# PlayingChord — Design Document

A web app for practicing piano chords with a MIDI keyboard. The app shows a random chord
from a chosen preset, the user plays it on their connected MIDI keyboard, and the app
validates the input and moves on to the next chord.

Status: **Draft v5** — session modes reworked with the user on 2026-07-16: two modes,
**Learn** (example voicing visible, untimed) and **Practice** (voicing hidden), with the
former timed/review modes folded into Practice-mode settings. Draft v4 (2026-07-15)
refined prompt emphasis, judging model, hint policy, goals/streaks, sound policy,
extended-chord stance, and no-device behavior. Both previously open questions are
resolved (see [§9](#9-resolved-questions)). Build sequencing (what gets implemented
first) is intentionally left outside this document.

**Key decisions:**
- Stack: React + TypeScript + Vite + Zustand, client-side only (no accounts/server).
- The **chord name is the prompt**; grand-staff notation (VexFlow) shows one *example*
  voicing in Learn mode. Staff-off stays first-class — the keyboard highlight carries
  Learn mode without notation.
- Chords are matched against a **voicing rule**: a composable spec (bass-note constraint,
  span, doubling policy). Matching is always rule-based — any voicing satisfying the rule
  counts, never only the notes drawn on the staff.
- Judging is **instant**: the attempt is correct the moment the held notes satisfy the
  rule; a miss latches only when the attempt can no longer succeed or stalls (§6.2).
- On a wrong attempt: **retry until correct**, with **progressive hints** — early misses
  only mark the wrong played keys; the expected keys are revealed from the 3rd miss.
- **Session modes**: **Learn** (example voicing shown from the start, untimed,
  stats-neutral) and **Practice** (default: voicing hidden, endless). Practice-mode
  settings: an optional **session timer** (with end-of-session summary) and a
  **worst chords only** toggle (replacing the old review mode) — plus subtle
  miss-weighting always.
- **Goals & streaks**: a daily practice-*time* goal with streak tracking, persisted
  locally alongside the existing stats history.
- Sound: **correct chime only** — misses are always visual-only.
- Extended chords (9th/11th/13th) stay in the library and are matched **literally**
  (every chord tone present, two hands allowed); omission/shell/rootless voicings are
  explicitly out of scope.
- A MIDI keyboard is **required** — no fallback input mode when none is connected.

---

## 1. Goals

- Connect to a MIDI keyboard in the browser and read played notes in real time.
- Generate random chords from a user-selected preset (e.g., "major triads", "seventh
  chords", "2nd inversion drills").
- Support the full **voicing** spectrum: any voicing, root position, specific inversions,
  closed/open position, and user-defined custom voicing rules — all built from the same
  composable model (see §3.3).
- Prompt with the chord **name** front and center; in Learn mode, show one example
  voicing (keyboard highlight + grand staff) to copy.
- Give feedback that doesn't rely on color alone (shape/icon cues), revealed
  progressively so recall is exercised before the answer is shown.
- Bias chord selection toward recently-missed chords (weighted repetition), offer a
  worst-chords-only Practice setting for explicit review, and persist stats across
  sessions.
- Practice sessions are endless by default; an optional session timer ends the session
  with a summary.
- Track a **daily practice-time goal and streak** to encourage regular practice.

### Non-goals

- No user accounts or server-side storage — everything (presets, custom voicing rules,
  stats history, goals/streaks) runs client-side, persisted in `localStorage` with JSON
  import/export for portability.
- No audio playback of the target chord — practice stays visual/notation-based, not ear
  training.
- No melody/scale/ear training — chords only.
- No hand-split drills (e.g. "left hand plays the root, right hand plays the chord") — a
  single chord played anywhere on the keyboard.
- No omitted-tone voicings (shell voicings, rootless voicings) — extended chords are
  drilled with all chord tones present (resolved, §9).
- No non-MIDI input fallback — with no MIDI device connected the app shows a blocking
  "connect a keyboard" screen (§6.1); unsupported browsers get a blocking message (§2).

---

## 2. Tech Stack

| Concern | Choice | Rationale |
|---|---|---|
| Framework | React + TypeScript + Vite | Fast dev loop, typed chord/MIDI models, no backend needed |
| MIDI | Web MIDI API (native) | No library required; wrapper module isolates it for testing |
| State | **Zustand** | Small app; simpler selector/update ergonomics than context for frequently-changing MIDI state (held notes) |
| Styling | Tailwind CSS | Quick iteration on practice UI |
| Notation | VexFlow | Render an example voicing on a grand staff — optional reference, not the prompt itself (§3.4) |
| Audio | Web Audio API (small wrapper) | Correct-chime only; misses are silent (§9) |
| Testing | Vitest | Chord theory + voicing matching are pure functions, easy to unit test |

**Browser support:** Web MIDI works in Chrome, Edge, and Opera; Firefox 108+ with
permission; **not Safari**. Unsupported browsers get a blocking message ("Web MIDI not
supported — try Chrome or Edge") — no degraded fallback input mode.

No backend. The app is a static site (deployable to GitHub Pages / Netlify).

---

## 3. Domain Model

### 3.1 Notes

- Internally everything is MIDI note numbers (60 = middle C).
- `PitchClass` = 0–11 (C=0 … B=11). A chord's identity is a set of pitch classes; a
  *voicing* is a concrete set of MIDI notes.
- Pitch classes alone can't drive notation — see §3.5 (spelling).

### 3.2 Chord

```ts
interface ChordType {
  id: string;            // "maj", "min7", "dom9", ...
  name: string;          // "Major", "Minor 7th", "Dominant 9th"
  intervals: number[];   // semitones from root, e.g. maj7 = [0, 4, 7, 11]
}

interface Chord {
  root: PitchClass;      // 0-11
  type: ChordType;
}
```

Built-in chord types: `maj`, `min`, `dim`, `aug`, `sus2`, `sus4`, `maj6`, `min6`, `add9`,
`maj7`, `min7`, `dom7`, `dim7`, `m7b5`, `maj9`, `min9`, `dom9`, `dom11`, `dom13`.
The list is developer-extensible — new types are data (id/name/intervals + spelling info,
§3.5) in a source file. Chord types are **not** user-editable in the UI; import/export
(§4) covers presets and custom voicing rules only.

**Extended chords (resolved, §9):** 9th/11th/13th chords are matched *literally* — every
chord tone must be present (octave doubling per the active rule). They're legitimately
hard and may need two hands; that's accepted. Presets should pair them with permissive
rules (`any`, `open`) — the preset editor warns when a chord type can't satisfy a rule
(e.g. a 5+-tone chord vs. `closed`'s span ≤ 11; see §4).

**Pitch-class identities:** some chords share pitch-class sets (Csus2 ≡ Gsus4) or are
symmetric (`dim7`, `aug`), so the matcher — which operates on pitch classes — accepts
either reading, and inversion labels for symmetric chords are nominal. Accepted as
harmless; presets mixing sus2 and sus4 just drill the same shapes under two names.

### 3.3 Voicing

Voicing rules are **composable and reusable**, stored the same way chord types are — as
named, id'd data — so new voicings (for you as developer, or for a user via the builder
UI in §7) don't require touching matcher code:

```ts
type BassConstraint =
  | { kind: "any" }                          // no constraint on the lowest held note
  | { kind: "chordTone"; degree: number };    // lowest note must be the chord tone at this
                                               // index into ChordType.intervals (0 = root,
                                               // 1 = 1st inversion, 2 = 2nd inversion, ...)

interface VoicingRule {
  id: string;                 // "any", "root-position", "first-inversion", "closed", ...
  name: string;                // display name, e.g. "1st Inversion"
  bass: BassConstraint;
  span?: { min?: number; max?: number };  // semitone range between lowest and highest held note
  doubling: "allowed" | "exact";           // whether repeated pitch classes (octave doubles) are permitted
}
```

Built-in library:

| id | bass | span | doubling |
|---|---|---|---|
| `any` | any | — | allowed |
| `root-position` | chordTone 0 | — | allowed |
| `first-inversion` | chordTone 1 | — | allowed |
| `second-inversion` | chordTone 2 | — | allowed |
| `closed` | chordTone 0 | max: 11 | exact |
| `open` | any | min: 12 | exact |

> `open` uses `exact` doubling deliberately: with doubling allowed, a closed voicing plus
> an octave double (C4 E4 G4 C5) would span ≥ 12 and wrongly count as "open".

Users can define additional rules (any combination of bass/span/doubling) through the
voicing builder (§7); custom rules join the same library and can be referenced by any
preset.

**Pattern rules** are a second `VoicingRule` kind for shapes a bass/span/doubling
constraint can't express — an arbitrary two-hand voicing, spelled out as chord degrees
from the bottom of each hand:

```ts
interface PatternVoicingRule {
  kind: "pattern";
  id: string;
  name: string;
  leftHand: number[];   // degrees from the bottom, e.g. [1, 5]
  rightHand: number[];  // e.g. [1, 2, 5]
}
```

A degree resolves against the specific chord being drilled (`theory/pattern.ts`):
1/3/5/7 (root/third/fifth/seventh) come only from the chord's own quality — a triad has
no 7th, so a pattern degree 7 is unsatisfiable on it, the same "incompatible pairing"
the preset editor already warns about for constraint rules. 2/4/6 (the "color" degrees,
also spelled 9/11/13) use the chord's own tone when it has one (a dom9's 9th) and
otherwise fall back to the plain major scale above the root, so e.g. `1-2-5` (an add-2
shape) is satisfiable over an ordinary triad. Degrees above 7 fold to 1-7 an octave up.
Matching is exact — held notes, sorted ascending, must equal the resolved
left-hand-then-right-hand pitch-class sequence — but octave placement is free (§6.3).

Omitted-tone primitives (`omittedDegrees` etc.) are **out of scope** — resolved in §9.

### 3.4 Prompt (what the user is asked to play)

```ts
interface Prompt {
  chord: Chord;
  voicing: VoicingRule;
  displayName: string;   // "C maj7" — root/type only. The voicing being drilled is
                          // shown separately (e.g. "2nd inversion"), never folded into
                          // a misleading slash-chord name.
  example: number[];      // one concrete voicing satisfying the rule (MIDI notes),
                          // deterministic per prompt — shown in Learn mode (keyboard
                          // highlight + staff) and used for the hint reveal (§6.4).
                          // Illustrative only: matching is against the rule, never
                          // against these notes.
}
```

`realizeVoicing(chord, rule) → number[]` (in `theory/`) picks a playable example near
middle C. The **name is the prompt**; `example` is Learn mode's answer display and the
hint reveal — never the match target.

### 3.5 Spelling (for notation)

Grand-staff rendering needs letter names and accidentals, which pitch classes don't
carry (the third of B major is D♯, not E♭). A small spelling module in `theory/`:

- **Root spelling:** default policy `C C♯ D E♭ E F F♯ G A♭ A B♭ B` (conventional mixed
  sharps/flats). The diatonic preset (§4) spells roots from its key instead.
- **Chord-tone spelling:** derived from the root's letter plus the interval's degree
  (each `ChordType` interval carries a degree so a ♯5 spells as ♯5, not ♭6).

---

## 4. Presets

A preset defines the pool the random generator draws from. Because some pools (e.g.
diatonic triads) are *pairs* of root+quality — not a full cross product — the pool has
variants:

```ts
type ChordPool =
  | { kind: "product"; roots: PitchClass[]; chordTypes: ChordTypeId[] }   // cross product
  | { kind: "explicit"; chords: { root: PitchClass; type: ChordTypeId }[] } // exact list
  | { kind: "diatonic"; key: PitchClass };  // major key → I ii iii IV V vi vii° as triads

interface Preset {
  id: string;
  name: string;
  pool: ChordPool;
  voicingIds: string[];         // references into the shared VoicingRule library (§3.3)
}
```

**Built-in presets** (all use the `any` voicing rule unless noted):

1. Major triads — all 12 roots
2. Minor triads — all 12 roots
3. Major + minor triads mixed
4. Seventh chords (maj7, min7, dom7)
5. All triad qualities (maj, min, dim, aug, sus2, sus4)
6. Diatonic triads in a key — `diatonic` pool; user picks a **major** key
7. Inversion drills — a triad/root product matched against `first-inversion` /
   `second-inversion` rules instead of `any`

**Validation:** the preset editor warns when a chord type in the pool can't satisfy one
of the preset's voicing rules (e.g. 5+-tone extended chords vs. `closed`'s span ≤ 11).

**Custom presets:** created/edited/deleted via a settings UI; stored in `localStorage`,
referencing built-in or user-defined voicing rules. **Import/export**: presets and any
custom voicing rules they depend on serialize to JSON for backup/transfer across browsers
or machines.

---

## 5. Random Generation

- A preset's pool expands to **combos** of (chord × voicingId). Stats are keyed per combo
  — `(root, typeId, voicingId)` — so missing "C maj7, 2nd inversion" doesn't up-weight
  root-position C maj7 (§8).
- **Weighted pick**: combos with a higher recent-miss rate are more likely to be
  selected. Combos with no history get a uniform baseline weight, so a fresh preset
  behaves as uniform-random; a new preset containing already-practiced combos inherits
  their history.
- **No immediate repeat**: the last `min(3, poolSize − 1)` combos are excluded, so small
  custom pools (≤ 3 combos) still generate.
- A subtle indicator marks prompts chosen because of recent misses (§7).
- **Worst chords only** (a Practice-mode setting, §7) inverts the emphasis: it draws
  only from the selected preset's worst combos instead of gently biasing the normal
  stream.
- Only Practice-mode attempts are recorded: Learn mode feeds neither the per-combo stats
  nor the weighting (§7), though its active time still counts toward the daily goal.

---

## 6. Input Handling & Matching

### 6.1 MIDI layer

- `midi.ts` module wraps Web MIDI: device enumeration, hot-plug events, note-on/note-off
  → a reactive "currently held notes" set (`Set<number>` of MIDI note numbers).
- Device picker UI when more than one input exists; last device remembered.
- **No device connected:** a blocking "connect a MIDI keyboard" screen replaces the
  practice view; hot-plug resumes practice automatically. There is no mouse/QWERTY
  fallback input (non-goal). MIDI is simulated in development/tests via the wrapper.

### 6.2 Attempt lifecycle

Judging is **instant** — correct the moment the rule is satisfied — with a defined
lifecycle per prompt:

1. **Arm:** an attempt arms only once the prompt is displayed **and** all keys are
   released. Notes still held from the previous prompt are never judged against the new
   one.
2. **Evaluate on every held-set change:**
   - Held set **satisfies the rule** (§6.3) → **correct** ✔: flash + reaction time +
     optional chime, then auto-advance after a configurable delay (default 800 ms).
     Notes pressed during the advance window are ignored; the next prompt arms per (1).
   - Held set is **definitively unsatisfiable** → **miss** ✘, immediately. Definitive
     means no additional key press could fix it: a non-chord pitch class is held (with
     Strict extra notes on), the span max is exceeded, or doubling is violated under
     `exact`.
   - **Stall:** the held set has at least the chord's tone count, doesn't satisfy the
     rule, and hasn't changed for the *judgment delay* (default 500 ms, configurable) →
     **miss**. This catches attempts that are technically extendable but clearly wrong
     (e.g. root position played in an inversion drill).
3. **Retry until correct:** after a miss, the same prompt stays and a hint is shown per
   the current hint stage (§6.4). Releasing all keys starts a new attempt. Releasing all
   keys *before* any judgment abandons the attempt silently (self-correction isn't
   punished, and doesn't advance hint stages).
4. **Skip:** a manual Skip button advances without counting against accuracy stats or
   the missed-chord weighting.

### 6.3 Matching rules

Given the active `VoicingRule`:

1. Held notes' pitch-class set must satisfy the chord's pitch classes, subject to the
   rule's `doubling`. `"exact"` = exactly one held note per chord tone. `"allowed"` =
   octave doubles of any chord tone are fine.
2. Any held note whose pitch class is **not** in the chord is a miss, unless the
   **Strict extra notes** setting (below) is off.
3. `bass`, if not `"any"`, must hold: the lowest held note's pitch class equals the
   specified chord tone.
4. `span`, if present, constrains the semitone distance between lowest and highest held
   note.

**Settings:**
- **Allow octave doubling** — default **on**. When off, every `VoicingRule`'s doubling
  behaves as `"exact"` regardless of the rule's own setting.
- **Strict extra notes** — default **on** (extra non-chord-tone notes always cause a
  miss). When off, extra notes are tolerated as long as all required chord tones are
  present (a more forgiving practice mode).

A **pattern** rule (§3.3) is exact by nature — 1-4 and the doubling/strict-extra-notes
settings don't apply. It matches when held notes, sorted ascending, have the same count
and pitch-class sequence as the rule's resolved left-hand-then-right-hand degrees;
octave placement is free. A held set that can never complete the sequence by adding more
notes (a foreign pitch class, too many notes, or an unrecoverable ordering) is a
definitive miss — for a pattern of *n* notes this covers every full-sized wrong attempt,
so pattern misses are always instant, never a stall-timer wait.

### 6.4 Progressive hints

Misses on the same prompt escalate the hint level — recall first, answer later:

- **Miss 1–2:** played keys that don't belong are marked (color + icon). If every played
  key *is* a chord tone (e.g. right notes, wrong inversion), the failed constraint is
  named as text instead ("bass must be the 3rd", "span too narrow"). For a pattern rule,
  a held note whose pitch class isn't anywhere in the pattern is marked the same way;
  otherwise the notes are all valid members but mis-ordered or excessive ("too many
  notes for this pattern", "notes out of order for this pattern").
- **Miss 3+:** the expected keys — the prompt's `example` voicing (§3.4) — are overlaid
  on the keyboard (color + icon) and highlighted on the staff if it's shown.

The escalation above describes **Practice mode**. In **Learn mode** the example is
visible from the start (the miss-3 reveal is effectively always on); wrong-key marking
still applies.

All overlays use color **and** a shape/icon distinction, never color alone.

---

## 7. UI / Screens

```
┌────────────────────────────────────────────────────┐
│ [Preset ▾] [Mode ▾] [Device ▾] 🔥12  [History] [⚙] │  ← top bar: streak + goal progress
├────────────────────────────────────────────────────┤
│              D min7 — 2nd inversion                 │  ← prompt: NAME is primary
│         🔥 Practicing: missed 3x recently           │  ← weighting indicator (when applicable)
│          𝄞  ♩♩♩♩ (grand staff, Learn mode)          │  ← example voicing, Learn mode
│                                                     │
│          ✔ Correct!  (1.2s)      [Skip →]   ⏱ 3:12 │  ← feedback line; timer if set
├────────────────────────────────────────────────────┤
│  🎹 on-screen keyboard (~3 octaves)                 │  ← live held keys; miss overlays
│                                                     │     escalate per hint stage (§6.4)
└────────────────────────────────────────────────────┘
```

- **Session modes** (top-bar picker):
  - **Learn**: the prompt's `example` voicing is shown from the start — highlighted on
    the on-screen keyboard and drawn on the staff (§3.4) — for the user to copy (any
    voicing satisfying the rule still counts). Untimed. Attempts are excluded from
    stats and weighting (§5); active minutes still count toward the daily goal.
  - **Practice** (default): the voicing is hidden — recall from the name, hints
    escalate per §6.4. Endless unless the timer is set. Practice-mode settings (shown
    with the picker when Practice is active):
    - **Timer**: off (default) or 5 / 10 / 15 min / custom — countdown in the UI, then
      an end-of-session summary (prompts played, accuracy, slowest/worst chords).
    - **Worst chords only**: drills the selected preset's worst combos (§5).
- **Prompt area**: chord name large and readable from a distance; the voicing being
  drilled as a text label (omitted for the `any` rule); in Learn mode the `example`
  voicing on a grand staff (§3.4) — a staff on/off setting keeps name+keyboard-only
  Learn first-class for users who don't read notation. A subtle indicator appears when
  the prompt was chosen due to recent misses (§5).
- **Keyboard visual**: shows currently held notes live; after misses, overlays escalate
  per the hint stages (§6.4), always color + shape/icon.
- **Feedback**: correct flash + reaction time + optional chime, auto-advance (default
  800 ms). Misses are always **visual-only** (§9). Skip button available (excluded from
  stats and weighting).
- **Goals & streaks**: daily goal = **active practice minutes** (default 10,
  configurable). Streak = consecutive days (local timezone) meeting the goal. Shown
  compactly in the top bar; detailed in History.
- **Stats panel** (live, session): prompts, first-try accuracy, average time-to-correct,
  worst chords. Definitions: *accuracy* = prompts answered correctly on the first
  attempt ÷ prompts (skips and Learn-mode prompts excluded); *time-to-correct* = prompt
  shown → correct match, retries included.
- **History tab** (separate view, top bar): persisted trends across all sessions —
  accuracy over time, time-to-correct trend, most-improved/worst chords, streak calendar
  and goal history. Reachable independently of the practice screen.
- **Voicing builder** (settings): dedicated form UI to compose a custom `VoicingRule`
  from bass/span/doubling primitives, save it to the shared library, and use it in any
  preset.
- **Preset editor** (settings): create/edit/delete presets (pool + voicing refs, §4)
  with rule-compatibility validation; import/export as JSON.
- **Settings**: preset editor, voicing builder, doubling toggle, strict-extra-notes
  toggle, staff on/off (Learn mode), correct-chime on/off, judgment delay, auto-advance
  delay, daily goal minutes. (The timer and worst-chords-only controls are Practice-mode
  settings living next to the mode picker, not in the settings panel.)

---

## 8. Project Structure

```
src/
  midi/           # Web MIDI wrapper, device management, held-note state, no-device detection
  theory/         # chord types, interval math, naming, spelling (§3.5), voicing rules,
                  #   matcher, realizeVoicing (pure, unit-tested)
  practice/       # session engine: attempt lifecycle (§6.2), prompt generation, weighted
                  #   selection, session modes (Learn/Practice + timer/worst-chords),
                  #   hint staging
  storage/        # localStorage persistence: presets, custom voicing rules, per-combo
                  #   stats history, daily practice totals + goal/streak state
                  #   (versioned schema, import/export)
  audio/          # Web Audio correct-chime
  components/     # PromptCard, KeyboardView, DevicePicker, PresetEditor, VoicingBuilder,
                  #   StatsBar, SessionSummary, HistoryView
  store/          # app state (settings, session) — Zustand
```

`theory/`, `practice/`, and `storage/` are pure TypeScript with no DOM/MIDI dependencies —
all matching, weighting, goal/streak, and persistence logic gets unit tests; MIDI input
is simulated for development without hardware.

Per-combo stat record (keyed `(root, typeId, voicingId)`, §5): attempts, first-try
successes, recent-miss window, time-to-correct samples. Daily record: date, active
minutes, prompts, first-try successes.

---

## 9. Resolved Questions

Build sequencing (what gets implemented in what order) is intentionally **not**
specified in this document — track it separately (e.g. an issue tracker).

1. **Voicing omissions** — *resolved: out of scope.* Extended chords (9th/11th/13th)
   are drilled literally with all chord tones present (§3.2); shell/rootless voicings
   and an `omittedDegrees` primitive are non-goals. Revisit only if literal extended
   drills prove unusable in practice.
2. **Sound feedback** — *resolved: chime-only.* A chime plays on correct (single on/off
   toggle, default on); misses are always visual-only. No buzz exists, so
   retry-until-correct can't get audibly fatiguing.
3. **Arbitrary two-hand voicings** — *resolved: pattern rules (§3.3).* A user asking to
   drill a specific shape like LH 1-5 / RH 1-2-5 shouldn't have to approximate it with
   bass/span/doubling. Pattern rules spell the shape out directly as degrees per hand
   and match exactly (§6.3); constraint rules remain for "any voicing satisfying a
   property." This doesn't reopen omitted-tone primitives (#1 above) — every pattern
   degree still names a real chord tone or the plain scale step above the root.
