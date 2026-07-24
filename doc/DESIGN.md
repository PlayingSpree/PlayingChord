# PlayingChord — Design Document

A web app for practicing piano chords with a MIDI keyboard. The app shows a random chord
from a chosen preset, the user plays it on their connected MIDI keyboard, and the app
validates the input and moves on to the next chord.

Status: **Draft v9** — **session-based UI** (2026-07-24): the app opens on a **Home**
screen and practice runs as explicit sessions — a session sheet picks preset, mode,
and a **length in prompts** (10/20/40/∞, replacing the Draft-v5 minute timer), the
**Stage** runs the session, and every session ends in a full-screen **Report** with a
session grade (the §5 chord-score formula applied to the session) and deltas against
a trailing-30-practiced-day baseline (§7). History becomes **Progress**, the upcoming
preview shrinks to the next 2 shown inline, and the visual language is redone
(reference mock: `doc/Prototype.dc.html`). Draft v8 added flashcard-style
**chord unlocking** (2026-07-19): each preset
starts with only its first 3 chords in play, and a fast first-try success on every
unlocked chord opens 2 more, until the whole pool is available (§5). Learn/Practice
generate only from unlocked chords; Song mode stays full-pool. A same-day revision
added an optional **circle-of-fifths unlock order** for root-ordered pools and an
unlock **toast** naming the newly opened chords (§5.1, §7). A 2026-07-20 revision
added a Learn-mode **"Not passed only"** setting, mirroring Practice's worst-chords
toggle, that narrows generation to unlocked-but-not-yet-passed chords (§5.1, §7). A
same-day follow-up renamed the unlock concept from "mastered" to **passed** throughout
(it's one fast first-try success, not real mastery) and added a per-chord breakdown to
the unlock chip, expandable by clicking it (§5.1, §7).
Draft v7 made Song mode
draw its progression from the **active preset's
chord pool** instead of a separate key selection (2026-07-18), so all three modes share
one preset picker; a diatonic preset keeps the starts-on-I / no-vii° / Roman-numeral
behavior (§6.5). Draft v6 (2026-07-17) added **Song mode**: a third session
mode that plays a short progression to a metronome, where the clock advances
instead of waiting for a correct answer (§6.5). Draft v5 (2026-07-16) reworked session
modes into **Learn** (example voicing visible, untimed) and **Practice** (voicing
hidden), with the former timed/review modes folded into Practice-mode settings. Draft v4 (2026-07-15)
refined prompt emphasis, judging model, hint policy, goals/streaks, sound policy,
extended-chord stance, and no-device behavior. Both previously open questions are
resolved (see [§9](#9-resolved-questions)). Build sequencing (what gets implemented
first) is intentionally left outside this document.

**Key decisions:**
- Stack: React + TypeScript + Vite + Zustand, client-side only (no accounts/server).
- The **chord name is the prompt**; grand-staff notation (VexFlow) shows one *example*
  voicing whenever the staff setting is on — in both Learn and Practice, from the first
  prompt, not gated on mode or miss count — optionally spelled in the chord root's major
  key with a key signature (a separate setting, §3.5). Staff-off stays first-class — the
  keyboard highlight carries Learn mode without notation.
- Chords are matched against a **voicing rule**: a composable spec (bass-note constraint,
  span, doubling policy). Matching is always rule-based — any voicing satisfying the rule
  counts, never only the notes drawn on the staff.
- Judging is **instant**: the attempt is correct the moment the held notes satisfy the
  rule; a miss latches only when the attempt can no longer succeed or stalls (§6.2).
- On a wrong attempt: **retry until correct**, with **progressive hints** — early misses
  only mark the wrong played keys; the expected keys are revealed from the 3rd miss.
- **Session flow**: the app opens on **Home**; a session is configured in a sheet
  (preset, mode, **length**: 10/20/40/∞ prompts) and always ends in a full-screen
  **Report** — session grade, trend deltas, passed/shaky chords (§7).
- **Session modes**: **Learn** (example voicing shown from the start,
  stats-neutral), **Practice** (default: voicing hidden), and **Song**
  (a 2–4-chord progression from the active preset's pool looped to a metronome — the
  bar boundary judges, not the player's success; §6.5). Practice keeps a
  **worst chords only** toggle (replacing the old review mode) — plus subtle
  miss-weighting always.
- **Chord unlocking**: flashcard-style progression per preset — start with 3 chords,
  pass them all (first-try, under 2 s) to unlock 2 more, repeating until the pool is
  open (§5). Gates Learn/Practice generation only; Song mode uses the full pool.
- **Goals & streaks**: a daily practice-*time* goal with streak tracking, persisted
  locally alongside the existing stats history.
- Sound: a **correct chime**, plus an optional **key-press piano tone**
  (the user's own playing, velocity-sensitive, default on) — misses are
  always visual-only.
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
  voicing to copy (keyboard highlight, plus the grand staff when the staff setting is on).
- Give feedback that doesn't rely on color alone (shape/icon cues), revealed
  progressively so recall is exercised before the answer is shown.
- Bias chord selection toward recently-missed chords (weighted repetition), offer a
  worst-chords-only Practice setting for explicit review, and persist stats across
  sessions.
- Practice runs as explicit sessions — a chosen number of prompts (10/20/40/∞)
  started from Home — each ending in a report with a session grade and trend deltas
  (§7.4).
- Simulate playing a real song: loop a short random progression from the selected
  preset against a fixed tempo, training chord *transitions* under time pressure
  (Song mode, §6.5).
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
| Audio | Web Audio API (small wrapper) | Correct-chime + key-press piano synth; misses are silent (§9) |
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
                          // deterministic per prompt — overlaid on the keyboard from
                          // the start in Learn mode, drawn on the staff whenever its
                          // setting is on (§3.4/§7), and used for the Practice-mode
                          // hint reveal (§6.4). Illustrative only: matching is against
                          // the rule, never against these notes.
}
```

`realizeVoicing(chord, rule) → number[]` (in `theory/`) picks a playable example near
middle C. The **name is the prompt**; `example` is the answer display (Learn keyboard
overlay + staff) and the Practice-mode hint reveal — never the match target.

### 3.5 Spelling (for notation)

Grand-staff rendering needs letter names and accidentals, which pitch classes don't
carry (the third of B major is D♯, not E♭). A small spelling module in `theory/`:

- **Root spelling:** default policy `C C♯ D E♭ E F F♯ G A♭ A B♭ B` (conventional mixed
  sharps/flats). The diatonic preset (§4) spells roots from its key instead.
- **Chord-tone spelling:** derived from the root's letter plus the interval's degree
  (each `ChordType` interval carries a degree so a ♯5 spells as ♯5, not ♭6).
- **Key signature option** (a staff setting, off by default): renders the grand staff in
  the chord's root as a major key — a VexFlow key signature next to the clefs, plus
  diatonic respelling of the chord tones. A tone whose letter+accidental already matches
  what the key signature implies gets no glyph; a plain (natural) tone whose letter the
  key signature alters gets a courtesy natural; anything else keeps its own sharp/flat as
  usual. Off, the staff always uses the fixed root/chord-tone spelling above.

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
- **Chord score**: a combo's recent accuracy scaled down by how far its recent average
  time-to-correct sits above the pass speed bar (§5.1's 2000 ms) — full credit at or
  under it, decaying smoothly past it, multiplicatively (being fast can't offset being
  wrong, or vice versa — the same AND logic the pass gate itself uses). Combos with
  no time samples (Song-mode-only, or no history) get full speed credit. A combo with no
  recent history scores at the uniform baseline (1). Drives both weighted pick below and
  the §7 chord stats grade.
- **Weighted pick**: combos with a lower chord score are more likely to be selected —
  so both a higher recent-miss rate and a slower recent average time-to-correct pull a
  combo toward the front. Combos with no history get a uniform baseline weight, so a
  fresh preset behaves as uniform-random; a new preset containing already-practiced
  combos inherits their history.
- **No immediate repeat**: the last `min(3, poolSize − 1)` combos are excluded, so small
  custom pools (≤ 3 combos) still generate.
- **Upcoming preview**: generation keeps a queue of the next 4 combos, dealt in
  order — the Stage displays only the first 2 (§7.3); the rest exist for the
  duplicate-exclusion below. One new combo is appended after each advance, picked with the
  then-current weights. Combos already queued join the no-immediate-repeat
  exclusion (extending it beyond the played-history window above) so the
  preview and the current prompt stay duplicate-free whenever the pool is
  large enough; a pool too small for 4 distinct combos repeats within the
  preview rather than leaving slots empty. The queue is rebuilt from scratch
  whenever the pool changes (preset, key, mode, worst-only, or a library
  edit).
- **Worst chords only** (a Practice-mode setting, §7.2) inverts the emphasis: it draws
  only from the selected preset's worst combos instead of gently biasing the normal
  stream.
- Only Practice-mode attempts are recorded: Learn mode feeds neither the per-combo stats
  nor the weighting (§7), though its active time still counts toward the daily goal.
- **Song mode** generates differently: it builds a whole *progression* up front rather
  than dealing from the weighted queue (§6.5). Its bar results do feed the per-combo
  stats, so Song-mode misses raise those combos' weights in Practice.

### 5.1 Chord unlocking (flashcard progression)

Every preset tracks its own **unlock progress**, so learning proceeds in small
flashcard-style batches instead of the whole pool at once:

- **Unlock order** is the pool's own order: chromatic-root order for `product` pools,
  scale-degree order (I → vii°) for `diatonic`, declared order for `explicit`/custom.
  A chord whose every combo is unsatisfiable (rule/type mismatch, §4) is skipped —
  it can never be attempted, so it must never occupy an unlock slot.
- **Circle-of-fifths order** (setting, default off): `product` pools unlock roots
  along the circle of fifths (C → G → D → A …) instead of chromatically — the
  classic pedagogy order; a root's chord types keep their relative pool order.
  Diatonic and explicit pools keep their own deliberate order regardless. Toggling
  re-derives the active preset's order in place: the unlocked *count* (and the
  positional passed indices, like a diatonic key change) carries onto the new
  order, so no progress is lost, though which chords are open shifts with it.
- A fresh preset starts with the **first 3** chords unlocked (clamped to the pool).
- A chord is **passed** by one Practice-mode attempt that is both **first-try
  correct** and **under 2000 ms** time-to-correct — one fast success, not real
  mastery, hence the wording. All the chord's voicing combos count toward the
  same chord; Learn-mode prompts, skips, and Song-mode bars never pass anything
  (they record no self-paced outcome).
- Once **every** unlocked chord is passed, the **next 2** unlock, repeating until
  the whole pool is open — after which generation behaves exactly as above. The
  upcoming-preview queue is rebuilt at the moment of an unlock (the pool changed,
  like any other pool change), so new chords can appear in the very next preview.
- **Scope:** the gate applies to Learn and Practice generation (worst-chords-only,
  Practice-only, and not-passed-only, Learn-only, then each narrow *within* the
  unlocked set — see the §7.2 session sheet). **Song mode is deliberately not gated** — it
  draws from the preset's full pool (§6.5); revisit if that proves confusing.
- **"Not passed only"** (a Learn-mode setting, §7, off by default, session-only like
  its Practice counterpart): narrows generation to unlocked chords not yet passed.
  If every unlocked chord is already passed, generation falls back to the whole
  unlocked pool rather than starving (mirrors "Worst chords only"'s empty-ranking
  fallback).
- **Persistence:** one record per preset id — the unlocked count plus the passed
  chords as *indices into the unlock order*, not chord identities, so the diatonic
  preset's progress means "scale degree N" and survives a key change. A custom
  preset's pool shrinking under its saved record reconciles (clamps) on load.
  Progress can be reset per preset in Settings. (The persisted field is still named
  `masteredIndices` in the JSON schema — a wording-only rename isn't worth a schema
  migration, §8.)

---

## 6. Input Handling & Matching

### 6.1 MIDI layer

- `midi.ts` module wraps Web MIDI: device enumeration, hot-plug events, note-on/note-off
  → a reactive "currently held notes" set (`Set<number>` of MIDI note numbers).
- Device picker UI when more than one input exists; last device remembered.
- **No device connected:** a blocking "connect a MIDI keyboard" screen replaces the
  **Stage** (§7.3) — Home, Progress, and Settings stay browsable without a device;
  starting a session without one shows the gate instead, and hot-plug resumes
  practice automatically. There is no mouse/QWERTY fallback input (non-goal). MIDI
  is simulated in development/tests via the wrapper.

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

The **keyboard's** answer overlay escalates progressively; the **grand staff**, when its
setting is on, is a separate, always-visible reference from the first prompt (§3.4) — it
doesn't wait for a miss. Misses on the same prompt escalate the keyboard's hint level —
recall first, answer later:

- **Miss 1–2:** played keys that don't belong are marked (color + icon). If every played
  key *is* a chord tone (e.g. right notes, wrong inversion), the failed constraint is
  named as text instead ("bass must be the 3rd", "span too narrow"). For a pattern rule,
  a held note whose pitch class isn't anywhere in the pattern is marked the same way;
  otherwise the notes are all valid members but mis-ordered or excessive ("too many
  notes for this pattern", "notes out of order for this pattern").
- **Miss 3+:** the expected keys — the prompt's `example` voicing (§3.4) — are overlaid
  on the keyboard (color + icon).

The escalation above describes **Practice mode**. In **Learn mode** the example is
overlaid on the keyboard from the start, so the miss-3 reveal stage doesn't exist
there — misses never escalate past the miss 1–2 hints, which still apply.

All overlays use color **and** a shape/icon distinction, never color alone.

### 6.5 Song mode

Song mode simulates playing a real song: a short chord progression drawn from the
active preset, looped against a metronome. Where Learn/Practice are **self-paced** (the attempt lifecycle of
§6.2 waits for the player), Song mode is **clock-paced** — the bar boundary judges, and
the music moves on whether the chord landed or not. The skill trained is *transitioning
between chords in time*, not precision striking. §6.2 does not apply here: no arming on
key release, no stall timer, no definitive-miss latching, no retry-until-correct, no
progressive hint escalation.

**Progression generation.** Chords come from the **active preset's chord pool** — the
same selection the other modes practice (§4), one picker for all three modes. A
progression is **2–4 chords** (a Song-mode setting, default 4), contains no repeated
chord, and is clamped to the pool's distinct chords when the pool is smaller. A
**diatonic** pool keeps its musical shape: the progression always **starts on I** and
**excludes vii°**, with the rest uniform-random; any other pool is drawn
uniform-random throughout. Voicing is always the `any` rule regardless of the preset's
voicing rules — voicing constraints under tempo are out of scope for now. The weighted
queue of §5 is not used.

**Timing.** One chord per bar, fixed at **4 beats**; tempo is a BPM setting (default
60, range 40–140). A metronome click (accented beat 1) runs throughout — a small
addition to `src/audio/` beside the chime. Every new progression starts with a
**one-bar count-in**.

**Judging — land it anywhere in the bar.** A bar is a **hit** if at any moment during
it the held notes satisfy the chord under the `any` rule (§6.3, with the global
doubling / strict-extra-notes settings applying as usual); otherwise it is a **miss**
when the bar ends. The held set is evaluated continuously — holding a chord across its
whole bar, releasing early, or changing chords legato (notes still down from the
previous bar) are all fine. A stricter "down by beat 1" variant is deliberately
deferred.

**Phrase structure.** The progression repeats **4 times** (fixed) as one *phrase* —
about 60–90 s at default tempo. At the end of a phrase a brief per-chord hit/miss
summary is shown, then a new progression is generated and counts in. Endless until the
user ends the session — the §7.2 length picker doesn't apply to Song — and ending
shows the Report like any other mode.

**Example voicing.** A Song-mode setting, **Show example** (default **on**), overlays
each bar's example voicing on the keyboard Learn-style (and the grand staff still
follows its own global setting, §3.4). Off, the keyboard shows only live held notes.
There is no miss-3 reveal — the next loop of the progression is the retry. In either
state, wrong held keys are marked with the miss-1 styling (§6.4), without escalation.

**Stats.** Each bar records into the existing per-combo stats keyed
`(root, typeId, "any")` (§5/§8): a hit is an attempt with a first-try success, a miss
is an attempt without one. No time-to-correct samples are recorded — there is no
"prompt shown → correct" span in a clock-paced bar. Active minutes count toward the
daily goal as in the other modes.

**Deferred (revisit after the random version proves itself):** curated famous
progressions (I–V–vi–IV etc. as named presets), rhythm variety (chords shorter or
longer than one bar), honoring the preset's voicing rules instead of `any`, minor
keys, and the stricter down-by-beat-1 judging variant.

---

## 7. UI / Screens

The app runs as explicit **sessions**: Home is the entry screen, a session sheet
configures preset/mode/length, the Stage runs the session, and a full-screen
Report ends it.

```
Home ──(Start / session sheet §7.2)──▶ Stage ──(length reached or End)──▶ Report
 ├──▶ Progress ──▶ Chord stats                     Report ──▶ Go again / Home
 └──▶ Settings
```

**Visual language** (reference mock: `doc/Prototype.dc.html`): dark navy surface,
green primary action color, cards and buttons as chunky 2px-bordered rounded
panels with a hard offset shadow, display typeface Bricolage Grotesque —
**self-hosted** (the app is client-side; no runtime font CDN). Feedback still
never relies on color alone (§6.4).

### 7.1 Home

The entry screen — the app boots here, not into practice. The no-device gate
(§6.1) doesn't block Home/Progress/Settings; it appears when a session starts.

- **Top bar**: app name · device picker · streak chip (🔥 N) · Settings.
- **Continue card** (primary): the active preset's name with a **Change**
  control (the preset picker, incl. the diatonic key picker); unlock progress —
  `N/total chords unlocked`, a bar, and how many unlock on the next pass (§5.1);
  an **In play** chip row — every unlocked chord with its letter grade (chord
  score §5 → A–F), not-yet-passed chords tagged *learning*, plus one
  `🔒 N locked` chip — this row is the per-chord breakdown that used to live
  behind the top-bar unlock chip; the **mode selector** (Learn / Practice /
  Song); and the **Start** button, labeled per mode.
- **Daily goal ring**: today's active minutes vs the goal (§7.6) and what's
  left to keep the streak.
- **Last 2 weeks**: a 14-day mini calendar of daily goal results
  (met / practiced-but-short / missed / today).
- **Progress button**: opens Progress (§7.5); shows this week's first-try
  accuracy with a delta vs the prior week.

### 7.2 Session sheet & length

A modal sheet — opened from Home and from the Stage's session label — holding
everything that defines a session:

- **Preset**: the same picker as the Continue card.
- **Mode**: Learn / Practice / Song, segmented. Each mode's sub-settings (§7.3)
  appear under the row while that mode is selected: Learn's *Not passed only*,
  Practice's *Worst chords only*, Song's *Tempo* / *Chords per progression* /
  *Show example*.
- **Length**: **10 / 20 / 40 / ∞ prompts** (default 20; session-only, resets on
  reload). Applies to Learn and Practice; hidden in Song, which runs until
  ended. This replaces the Draft-v5 minute timer — the daily goal tracks active
  minutes regardless (§7.6).

Reaching the length — or the Stage's **End** button, any mode, any time — ends
the session and shows the Report (§7.4); ending with zero prompts played
returns Home instead.

### 7.3 Stage (the in-session screen)

```
┌─────────────────────────────────────────────────────┐
│ [Seventh chords · ▶ Practice ▾]  ▓▓▓░░ 12/20  [End] │ ← session label opens the
├─────────────────────────────────────────────────────┤   sheet; center varies by mode
│    D min7 — 2nd inv     (G maj)  (A min)            │ ← prompt + next 2 inline
│    𝄞 (grand staff, if staff setting on)             │
│          [ ✔ Correct! 1.2s ]     [Skip →]           │ ← feedback pill
├─────────────────────────────────────────────────────┤
│  🎹 on-screen keyboard (~3 octaves)                 │ ← live held keys; overlays
└─────────────────────────────────────────────────────┘   escalate per §6.4
```

- **Top bar, per mode**: the session label (preset + mode) opening the sheet, an
  **End** button, and in the center — Practice: a progress bar with
  `done / length` (∞ shows the count alone); Learn: the *Not passed only* state
  plus a compact `🔓 N/total` unlock count; Song: tempo and loop chips. The old
  always-visible unlock chip is gone — Home's In play row carries the per-chord
  breakdown — but the transient unlock **toast** ("🔓 New chords unlocked:
  A, E") still fires at the mid-session unlock moment.
- **Session modes**:
  - **Learn**: the prompt's `example` voicing is shown from the start — highlighted on
    the on-screen keyboard, and drawn on the grand staff when the staff setting is on
    (§3.4) — for the user to copy (any voicing satisfying the rule still counts).
    Attempts are excluded from stats and weighting (§5); active minutes still
    count toward the daily goal. Learn-mode setting (in the session sheet, §7.2):
    - **Not passed only**: narrows generation to the selected preset's unlocked
      chords not yet passed (§5.1).
  - **Practice** (default): the voicing is hidden from the keyboard — recall from the
    name, keyboard hints escalate per §6.4 — but the grand staff (if its setting is on)
    is visible from the first prompt, independent of misses. Runs to the session
    length (§7.2). Practice-mode setting (in the session sheet):
    - **Worst chords only**: drills the selected preset's worst combos (§5).
  - **Song**: a looped progression from the active preset against a metronome —
    clock-paced judging per §6.5. The preset picker (and, for the diatonic preset,
    its key picker) works exactly as in the other modes; switching mid-song rebuilds
    the progression with a fresh count-in.
    Song-mode settings (in the session sheet):
    - **Tempo**: BPM, default 60, range 40–140.
    - **Chords per progression**: 2 / 3 / 4 (default 4).
    - **Show example**: default on — each bar's example voicing overlaid on the
      keyboard, Learn-style (§6.5).

    Display: the upcoming-preview chip row becomes the **progression display** — the
    whole progression as chips (`C — G — Am — F`) with Roman numerals underneath
    (`I — V — vi — IV`) when the pool is diatonic (the key is known; other pools show
    no numerals), the current chord's chip highlighted and pulsing on the beat, and a
    hit/miss icon stamped on each chip as its bar completes. The current chord's name
    stays the large primary prompt as usual.
- **Prompt area**: chord name large and readable from a distance, size configurable in
  settings (small/medium/large/extra-large, default large); the voicing being drilled
  as a text label (omitted for the `any` rule); the `example` voicing on a grand staff
  (§3.4) whenever the staff setting is on, in either mode — optionally in the chord
  root's key (key signature setting, §3.5) — off by default keeps name+keyboard-only
  practice first-class for users who don't read notation. Beside the name, the
  **next 2** upcoming combos in dealing order (§5) render inline at decreasing
  sizes and muted colors, each labeled like the worst-chords list (name, plus
  voicing unless it's the `any` rule); Song mode's progression display (§6.5)
  keeps a left-to-right row instead, since it reads in time. Both scale with the
  chord-name size setting so they stay readable from the same distance as the name.
- **Keyboard visual**: shows currently held notes live; in Practice, after misses,
  overlays escalate per the hint stages (§6.4), always color + shape/icon; Learn mode
  overlays the example voicing from the start instead. When a note falls outside the
  drawn ~3-octave range (custom two-hand voicings can place a left-hand note below it,
  §6.3), its whole note set octave-shifts together into view — held + wrong-key marks
  as one shape, the answer overlay as another — so the voicing's shape stays intact; a
  shape wider than the drawn range folds the leftover notes per note.
- **Feedback**: a pill under the prompt — correct flash + reaction time + optional
  chime, auto-advance (default 800 ms). Misses are always **visual-only** (§9). Skip
  button available (excluded from stats and weighting). A **combo streak**
  (consecutive first-try correct prompts, reset by any miss; skips leave it
  untouched) rides the same flash once it reaches 10 ("🔥 10 combo"). Session-only —
  not shown elsewhere — but the longest streak ever reached is tracked lifetime
  (§7.5 Progress). There is no separate live stats panel — session stats surface in
  the Report.

### 7.4 Report (end of session)

Every session ends here, full-screen (replacing the Draft-v5 summary modal).
Stat definitions carry over unchanged: *accuracy* = prompts answered correctly
on the first attempt ÷ prompts (skips and Learn-mode prompts excluded);
*time-to-correct* = prompt shown → correct match, retries included; Song bars
count as prompts, a hit being a first-try success (§6.5).

- **Session grade** (A–F): the session's first-try accuracy and average
  time-to-correct fed through the §5 chord-score formula — accuracy scaled by
  the speed factor against the 2000 ms bar — mapped to the same letter
  thresholds as the chord-stats grade, so session and per-chord grades mean the
  same thing. Song sessions have no time samples → full speed credit, exactly
  as §5 scores such combos. Learn sessions are stats-neutral (§5): no grade, no
  accuracy/speed cards — just prompts played, active time, and the goal line.
- **Stat cards**: session *First-try accuracy* and *Avg time-to-correct*, each
  with a **delta vs the trailing baseline** — the mean over the last **30
  practiced days** (days with ≥ 1 counted prompt, from the daily records,
  excluding today); no baseline data → no delta shown. Plus lifetime **Total
  prompts** and **Total time**, each with this session's increment. The
  avg-time baseline reads the daily records' existing per-day time sums with
  the same `timeToCorrectMs / prompts` convention the Progress trend chart
  uses — including its accepted approximation that Song bars count as prompts
  while contributing no time.
- **Best chord average** (fastest per-chord average time this session, so one
  lucky rep can't set it) and the session's **slowest/worst chords** carry over
  from the old summary as secondary lines.
- **Unlock banner**: when the session unlocked chords — names them and shows
  pool progress toward the next batch (§5.1).
- **Chords passed** this session (§5.1 passes) and **Still shaky** — chords
  missed this session, with miss counts.
- **Goal line**: today's state after the session ("🔥 Streak safe — 10/10 min
  done today", or the minutes remaining).
- **Go again** (a fresh session with the same sheet config) / **Home**.

### 7.5 Progress & chord stats

**Progress** (formerly *History*; reached from Home) — persisted trends across
all sessions:

- **Header stat cards**: current & best streak, total practice time, days
  practiced, total prompts.
- Accuracy over time and time-to-correct trend (30 days), the goal/streak
  calendar (12 weeks), most-improved / needs-work chords, goal history, and the
  lifetime **best combo streak** (the longest run of consecutive first-try
  prompts ever reached, across all sessions).
- A **chord stats** drill-down (its own screen, linked from Progress)
  lists every practiced combo — not just the top-3 worst/most-improved — with a letter
  **grade** (A–F, from the combo's chord score, §5), attempts, lifetime and recent
  accuracy, and lifetime and recent avg time-to-correct, sortable by any column. *Recent*
  windows differently per metric: accuracy uses the same window that drives weighting
  (§5, the most outcomes ever kept per combo); avg time uses its own wider window, since
  more time samples are kept per combo than outcomes.

### 7.6 Goals, streaks & settings

- **Goals & streaks**: daily goal = **active practice minutes** (default 10,
  configurable). Streak = consecutive days (local timezone) meeting the goal.
  Shown on Home (goal ring + streak chip) and after each session in the
  Report's goal line; detailed in Progress.
- **Voicing builder** (settings): dedicated form UI to compose a custom `VoicingRule`
  from bass/span/doubling primitives, save it to the shared library, and use it in any
  preset.
- **Preset editor** (settings): create/edit/delete presets (pool + voicing refs, §4)
  with rule-compatibility validation; import/export as JSON. Each preset row (built-in
  and custom) also offers **Reset progress**, restarting its §5.1 unlocks at the
  initial count.
- **Settings** (grouped into cards: Sound / Notation / Matching & timing /
  Goal & unlocks / Voicing rules / Presets): preset editor, voicing builder,
  doubling toggle, strict-extra-notes
  toggle, chord name size (small/medium/large/extra-large, default large), staff
  on/off, staff key signature on/off (chord root as key, §3.5), correct-chime on/off,
  piano sound on key press on/off (§9), judgment delay, auto-advance delay, daily
  goal minutes, circle-of-fifths unlock order on/off (§5.1). (Mode sub-settings —
  worst-chords-only, not-passed-only, Song's tempo / chords-per-progression /
  show-example — live in the session sheet, §7.2, not the settings panel; the
  session length lives there too.)

---

## 8. Project Structure

```
src/
  midi/           # Web MIDI wrapper, device management, held-note state, no-device detection
  theory/         # chord types, interval math, naming, spelling (§3.5), voicing rules,
                  #   matcher, realizeVoicing (pure, unit-tested)
  practice/       # session engine: attempt lifecycle (§6.2), prompt generation, weighted
                  #   selection, session modes (Learn/Practice + length/worst-chords,
                  #   Song progression + bar clock §6.5), hint staging, report
                  #   derivations (grade + baselines §7.4), unlock
                  #   progress (§5.1, progress.ts)
  storage/        # localStorage persistence: presets, custom voicing rules, per-combo
                  #   stats history, daily practice totals + goal/streak state,
                  #   per-preset unlock progress (§5.1)
                  #   (versioned schema, import/export)
  audio/          # Web Audio: correct-chime, key-press piano synth, metronome click
                  #   (shared context)
  components/     # HomeView, SessionSheet, PromptCard, KeyboardView, ReportView,
                  #   ProgressView, ChordStatsView, DevicePicker, PresetEditor,
                  #   VoicingBuilder
  store/          # app state (settings, session) — Zustand
```

`theory/`, `practice/`, and `storage/` are pure TypeScript with no DOM/MIDI dependencies —
all matching, weighting, goal/streak, and persistence logic gets unit tests; MIDI input
is simulated for development without hardware.

Per-combo stat record (keyed `(root, typeId, voicingId)`, §5): attempts, first-try
successes, recent-miss window, time-to-correct samples. Daily record: date, active
minutes, prompts, first-try successes, and the day's summed time-to-correct ms —
the Report's trailing-30-practiced-day baselines (§7.4) read these existing
fields; no schema change is needed for v9. Preset progress record (keyed by preset id,
schema v2, §5.1): unlocked count + passed chord indices (still `masteredIndices` in the
JSON, §5.1). Best combo streak (schema v2, §7): a single lifetime integer, raised
whenever a session's live streak beats it.

---

## 9. Resolved Questions

Build sequencing (what gets implemented in what order) is intentionally **not**
specified in this document — track it separately (e.g. an issue tracker).

1. **Voicing omissions** — *resolved: out of scope.* Extended chords (9th/11th/13th)
   are drilled literally with all chord tones present (§3.2); shell/rootless voicings
   and an `omittedDegrees` primitive are non-goals. Revisit only if literal extended
   drills prove unusable in practice.
2. **Sound feedback** — *resolved: chime plus a key-press piano, misses stay silent.*
   A chime plays on correct (single on/off toggle, default on). A velocity-sensitive
   oscillator piano synth additionally voices the user's own key presses (its own
   toggle, default on) — this is the player's own playing, not feedback, so it doesn't
   change the resolution: misses are still always visual-only. No buzz exists, so
   retry-until-correct can't get audibly fatiguing.
3. **Arbitrary two-hand voicings** — *resolved: pattern rules (§3.3).* A user asking to
   drill a specific shape like LH 1-5 / RH 1-2-5 shouldn't have to approximate it with
   bass/span/doubling. Pattern rules spell the shape out directly as degrees per hand
   and match exactly (§6.3); constraint rules remain for "any voicing satisfying a
   property." This doesn't reopen omitted-tone primitives (#1 above) — every pattern
   degree still names a real chord tone or the plain scale step above the root.
