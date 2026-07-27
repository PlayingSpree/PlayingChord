# PlayingChord — Design Document

A web app for practicing piano chords with a MIDI keyboard. The app shows a random chord
from a chosen preset, the user plays it on their connected MIDI keyboard, and the app
validates the input and moves on to the next chord.

Spec version: **9.5.1** (2026-07-27) — session-based UI. Revision history lives in
[CHANGELOG.md](CHANGELOG.md); this document describes only what the app *is* today.
Both previously open questions are resolved (see [§9](#9-resolved-questions)). Build
sequencing (what gets implemented first) is intentionally left outside this document.

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
  pass them all (grade D or better, §5.1) to unlock 2 more, repeating until the pool
  is open (§5). Gates Learn/Practice generation only; Song mode uses the full pool.
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

React + TypeScript + Vite, Zustand for state, Tailwind, VexFlow for notation, Web
Audio for sound, Vitest for tests — `package.json` is the authority on what's
actually installed. Two choices worth recording: **Zustand** over context, because
held notes change on every MIDI event and context re-renders too broadly; and
**native Web MIDI** with no library, behind a wrapper module, so the whole app is
testable and developable without hardware.

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

A **chord type** is an id, a display name, and its intervals from the root; a
**chord** is a root pitch class plus a type (`theory/chordTypes.ts`). Each interval
carries its scale **degree** alongside the semitone count — that's what lets a ♯5
spell as ♯5 rather than ♭6 (§3.5); semitones alone can't decide it.

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
UI in §7) don't require touching matcher code. A rule is one of two kinds
(`theory/voicingRules.ts`).

A **constraint rule** describes properties any satisfying voicing must have:
a **bass** constraint (unconstrained, or "the lowest note is chord tone *n*" —
index 0 = root position, 1 = 1st inversion, …), an optional **span** in semitones
between lowest and highest held note, and a **doubling** policy (`allowed` or
`exact` — whether octave doubles of a chord tone are permitted).

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

**Pattern rules** are the second kind, for shapes a bass/span/doubling constraint
can't express — an arbitrary two-hand voicing, spelled out as chord degrees from the
bottom of each hand (LH `1-5`, RH `1-2-5`). A degree resolves against the specific chord being drilled (`theory/pattern.ts`):
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

A prompt (`practice/prompts.ts`) is the chord being drilled, the voicing rule it's
matched against, a **display name** and an **example** voicing.

The display name is root/type only — "C maj7". The voicing being drilled is shown
separately ("2nd inversion"), never folded into a misleading slash-chord name.

The example is one concrete set of MIDI notes satisfying the rule, deterministic per
prompt — `realizeVoicing(chord, rule)` in `theory/` picks a playable one near middle
C. It is overlaid on the keyboard from the start in Learn mode, drawn on the staff
whenever that setting is on (§7), and revealed as the Practice-mode miss-3 hint
(§6.4). It is illustrative only: the **name is the prompt** and matching is always
against the rule, never against these notes.

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

- **product** — a cross product of roots × chord types.
- **explicit** — an exact list of root/type pairs.
- **diatonic** — a major key, expanded to I ii iii IV V vi vii° as triads.

A preset is an id, a name, one such pool, and references into the shared
`VoicingRule` library (§3.3) — never inlined rules, so a rule edit reaches every
preset using it (`practice/presets.ts`).

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
- **Chord score**: a combo's recent accuracy times a **speed factor** — the
  piecewise-linear ramp defined by the §7.5 grade seconds: full credit (1) at or under
  **1 s**, then **0.2 lower per second** — 0.8 at 2 s, 0.6 at 3 s, 0.4 at 4 s, 0.2 at
  5 s — running down to **0** at the §6.2 recording ceiling (10 s). The two axes
  multiply, so being fast can't offset being wrong or vice versa — which is also
  what makes this score fit to gate §5.1's pass. Because the ramp's cut points *are* the grade thresholds,
  a flawless recent window grades exactly on those round seconds (§7.5). Combos with no
  time samples (Song-mode-only, or no history) get full speed credit, and a combo with
  no recent history *at all* scores at the uniform baseline (1) — the same score a clean,
  S-speed combo earns, so drilling a chord to an S never makes it crowd out an
  untouched one. Drives both weighted pick below and the §7 chord stats grade.
- **Recent window**: the last **10** outcomes, the most ever kept per combo (§8).
  Ten is a multiple of the five grade bands, so every cut point lands exactly on a
  bucket of the window and a letter takes **two** misses to move — one rep can no
  longer flip a grade.
- **Evidence floor**: once a combo has *any* history, its accuracy is divided by
  **5** until the window holds that many — the reps it hasn't played yet count as
  misses. A combo is unproven rather than flawless or hopeless: one clean rep is
  1/5, not 1/1. This is what keeps a single lucky rep from grading S and passing a
  chord on its own (§5.1), and a single miss from reading as a settled F. The floor
  is half the window, the same shape as the time window in §7.5, and it applies
  wherever the score does — grade, weighting and pass alike, so they can't disagree.
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
  only from the selected preset's weak spots instead of gently biasing the normal
  stream — its **worst combos** (worst-ranked first, so the ranking still leads the
  weighted draw) *plus* its **not-yet-passed chords** (§5.1). A chord that has never
  been passed belongs in a weak-spots drill even with a clean record: most likely it
  has barely been played, and excluding it would leave the toggle able to revisit old
  mistakes but never the gaps. Only when every unlocked chord is passed and nothing
  was ever missed does it fall back to the whole unlocked pool.
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
- A chord is **passed** by a Practice-mode attempt after which its **grade is D or
  better** (§7.5) — every letter but F. The pass bar is therefore the grade the
  player already reads everywhere else rather than a private threshold: "learned"
  means the recent window of reps is no longer failing, not real mastery, hence
  the wording. (9.2.0 replaced the original bar — one first-try success under
  2000 ms — because a single lucky rep passed a chord the stats still graded F,
  and because a steady-but-unhurried player could never unlock anything at all.)
  With the §5 evidence floor the bar is **about two clean reps** at an ordinary
  pace rather than one — one rep is 1/5 of a window, which only clears D if it
  also lands inside S's second, where a single rep is unambiguous evidence.
  A chord spanning several voicing combos takes the **worst** combo's grade, the
  same figure Home's In play row shows, so a chord can't read red there and pass
  here; combos with no history yet don't count against it. Passing is a **latch** —
  a chord whose grade later falls back to F stays passed and its unlock stays
  open, since the unlock queue is a ratchet and the live grade is reported
  elsewhere anyway. Learn-mode prompts, skips, and Song-mode bars never pass
  anything (they record no self-paced outcome).
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
  practice automatically. An unplug mid-session doesn't lose it: the session stays
  live behind the gate and **resumes at its own count** when the device returns
  (§7.2). The gate also offers a way back to Home, ending the session like the
  Stage's End button, so it is never a dead end. There is no mouse/QWERTY fallback
  input (non-goal). MIDI is simulated in development/tests via the wrapper.

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

**Time-to-correct ceiling.** A recorded time-to-correct is clamped to **10 000 ms**.
A prompt left sitting — a pause to think, a distraction, a walk away from the
keyboard — is not a 47-second recall, and one of them would otherwise drag the
combo's recent average, and so its weighting (§5) and grade (§7.5), for the whole
window after. The clamp is applied once, where the completed prompt is recorded, so
per-combo stats, unlock progress, the session tallies, the Report log and the day's
summed time all see the same capped value; past it the feedback pill reads `10.0s+`
(§7.3). The ceiling sits well above the §7.3 slow bar, so a clamped rep is always
already flagged slow — the clamp only decides *how far* past it counts. The §7.3
ready gate handles the other end of the same problem — the walk-up before the
*first* prompt.

A rep that *reaches* the ceiling enters the **grade** window as a miss, even
though the right keys eventually went down. Ten seconds of hunting is not recall,
and letting it through as a first-try success left the accuracy axis reading
flawless while only the speed axis — already at zero there — disagreed, so a
stalled combo could still grade well above what it had shown. The demotion is
for grading alone (the per-combo recent window behind §5 weighting and the §7.5
letter): everywhere the player is simply told what they played — lifetime
accuracy, the session tallies and their grade, the Report log, the daily figures
(§7.6), the §7.3 combo streak — the prompt still counts as the first-try success
it was.

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

- **Top bar**: app name · build tag · device picker · streak chip (🔥 N) ·
  Settings. The **build tag** is the spec version this build implements, and —
  only when the build didn't come from `master` — the branch it came from.
  Previews deploy to the same URL as production (README, *Deployment*), so a
  screenshot has to be able to say which build it is; on production the branch
  is noise and stays hidden. Both values are fixed at build time, not read at
  runtime.
- **Continue card** (primary): the active preset's name with a **Change**
  control (the preset picker, incl. the diatonic key picker); unlock progress —
  `N/total chords unlocked`, a bar, and how many unlock on the next pass (§5.1);
  an **In play** chip row — every unlocked chord with its letter grade (chord
  score §5 → S–F, or `new` where the evidence floor hasn't been reached, §7.5),
  not-yet-passed chords tagged *learning* instead of lettered at all, plus one
  `🔒 N locked` chip — this row is the per-chord breakdown that used to live
  behind the top-bar unlock chip. The 🔒 chip is a **disclosure**: clicking it
  names the locked chords, in unlock order (§5.1), so "what's coming next" is
  answerable without guessing. Then the **mode selector** (Learn / Practice /
  Song) — configuration only, like everything else outside a session (§7.2);
  and the **Start** button, labeled per mode.
- **Daily goal ring**: today's active minutes vs the goal (§7.6) and what's
  left to keep the streak.
- **Last 2 weeks**: a 14-day mini calendar of daily goal results
  (met / practiced-but-short / missed / today).
- **Progress button**: opens Progress (§7.5); shows this week's first-try
  accuracy with a delta vs the prior week.

### 7.2 Session sheet & length

A session runs **only between Start and its end** (the length, the End button,
or the gate's way back). Outside one — on Home, or in the sheet — the mode and
preset controls are pure configuration: nothing is dealt, judged, recorded or
counted, and Song's clock stays silent until the Stage opens.

A modal sheet — opened from Home and from the Stage's session label — holding
everything that defines a session. Opened over a running session it **pauses**
it, and its picks are a draft: **Start** applies them to a new session, while
closing (✕ / Escape / backdrop) resumes the paused session unchanged, at its own
count. Song's tempo / chords-per-progression / show-example are the exception —
persisted preferences that apply from the next beat or progression (§7.3), not
session config, so they take effect as they're set.

- **Preset**: the same picker as the Continue card.
- **Mode**: Learn / Practice / Song, segmented. Each mode's sub-settings (§7.3)
  appear under the row while that mode is selected: Learn's *Not passed only*,
  Practice's *Worst chords only*, Song's *Tempo* / *Chords per progression* /
  *Show example*.
- **Length**: **10 / 20 / 40 / ∞ prompts** (default 20; session-only, resets on
  reload). Applies to Learn and Practice — both show the count on the Stage
  (§7.3) — and is hidden in Song, which runs until ended. This replaces the
  Draft-v5 minute timer — the daily goal tracks active minutes regardless
  (§7.6).

Reaching the length — or the Stage's **End** button, any mode, any time — ends
the session and shows the Report (§7.4); ending with zero prompts played
returns Home instead. Leaving the Stage without ending it (the sheet, the
no-device gate §6.1) only pauses: the session keeps its count, tallies and
recorded prompts, and returning resumes it with a freshly dealt prompt (Song
counts a new progression in).

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

- **Ready gate** (Practice only): the Stage opens on a **Ready?** panel instead
  of a prompt — the first chord is dealt by a tap on the panel or by any note
  played, and only then does its time-to-correct clock start (§6.2). Otherwise
  the walk-up to the keyboard lands in the first sample, dragging the combo's
  grade — and with it the §5.1 pass — for no musical reason. It gates the *first* prompt
  of every Stage entry, a resume (the sheet, the §6.1 gate) included, and any
  pool change arriving while it's still up leaves it up. Learn is stats-neutral
  (§5) and Song counts itself in (§6.5), so neither gates. The on-screen
  keyboard stays live behind the panel for warming up.
- **Top bar, per mode**: the session label (preset + mode) opening the sheet, an
  **End** button, and in the center — Learn and Practice: a progress bar with
  `done / length`; ∞ keeps the count but has no length to fill, so its bar and
  readout track **today's goal minutes** instead (`🔥 6 / 10 min`, then
  `🔥 Streak safe` — §7.6), the only thing still pacing an endless session. It
  advances as active time flushes, so it moves only while playing. Learn adding the
  *Not passed only* state and a compact `🔓 N/total` unlock count; Song: tempo
  and loop chips (the length doesn't apply). The old
  always-visible unlock chip is gone — Home's In play row carries the per-chord
  breakdown — but the transient unlock **toast** ("🔓 New chords unlocked:
  A, E") still fires at the mid-session unlock moment.
- **Grade-up notice**: a combo's grade rides a *recent* window (§5), so it can
  climb mid-session; when it does, a line under the feedback pill says so
  ("📈 C maj grade up: D → C"), rather than leaving the news for the player's
  next visit to the chord stats page (§7.5). It belongs to the rep that earned
  it, so it is decided on the same judgment edge as the `learned` callout and
  lasts exactly as long as that rep's ✔ flash — a toast on a window of its own
  arrived after the prompt it was about had already gone. Both grades must rest
  on at least the most-improved evidence floor (§7.5's 5 attempts) — below that
  a letter swings on one rep and the notice would be noise. Each letter is news
  **once per session per combo**: a moving window means a combo hovering on a
  cut point re-crosses it every few reps, and B → A → B → A would announce the
  same A over and over. The repeat is silent; the next *new* letter (the S after
  it) still fires. Practice only: Learn records nothing (§5) and Song's bar
  chips already report themselves.
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
    - **Worst chords only**: drills the selected preset's worst combos and its
      not-yet-passed chords (§5).
  - **Song**: a looped progression from the active preset against a metronome —
    clock-paced judging per §6.5. The preset picker (and, for the diatonic preset,
    its key picker) works exactly as in the other modes; switching mid-song rebuilds
    the progression with a fresh count-in.
    Song-mode settings (in the session sheet):
    - **Tempo**: BPM, default 60, range 40–140 — ± in 5 bpm steps or typed in
      directly (committed on blur).
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
  chime, auto-advance (default 800 ms). A Practice-mode answer past the **slow
  bar** turns the flash amber and adds a **`· slow`** chip. The bar is not a
  number of its own: it is **D's second (5 s)**, the last one that still grades
  (§7.5) — so one rep earns the chip exactly when a window of such reps would
  grade the combo F on speed alone, and the in-the-moment feedback can't drift
  from the letter it feeds. An answer at or under **A's second (2 s)** is the
  mirror image — the flash turns blue with a **`· fast`** chip, marking the reps
  that hold an A on speed alone. Between the two bars the pill is plain green: a
  perfectly ordinary answer says nothing extra. Both chips follow the number
  displayed, so a slow answer after a retry gets it too
  (time-to-correct includes retries), and past the §6.2 ceiling the pill reads
  `10.0s+` — what was actually recorded. Learn shows the answer from the start
  and Song is clock-paced, so neither grades speed. When a rep takes a chord that
  was still in learning (§5.1: unlocked, not yet passed) to a passing grade, the
  pill also says **`★ learned`** — the one moment that word is news. It is the
  same pass call §5.1 makes, decided on the judgment edge rather than on the
  advance, so the flash announcing it is still on screen. Misses are always
  **visual-only** (§9). Skip
  button available (excluded from stats and weighting). A **combo streak**
  (consecutive first-try correct prompts, reset by any miss; skips leave it
  untouched) rides the same flash once it reaches 10 ("🔥 10 combo"). Both edges
  land on the judgment itself: the ✔ counts itself (so the 10th first-try
  correct is the one that says 10), and a miss drops the streak the instant the
  ✘ lands — silently, with no lost-combo callout, and whether or not the prompt
  is later completed or skipped. **Switching mode** ends the run too: only
  Practice can break a streak — Learn records no outcome and Song is
  clock-paced — so a detour would otherwise park the count and hand it back
  intact. Session-only —
  not shown elsewhere — but the longest streak ever reached is tracked lifetime
  (§7.5 Progress). There is no separate live stats panel — session stats surface in
  the Report.

### 7.4 Report (end of session)

Every session ends here, full-screen (replacing the Draft-v5 summary modal).
Stat definitions carry over unchanged: *accuracy* = prompts answered correctly
on the first attempt ÷ prompts (skips and Learn-mode prompts excluded);
*time-to-correct* = prompt shown → correct match, retries included; Song bars
count as prompts, a hit being a first-try success (§6.5).

- **Session grade** (S–F): the session's first-try accuracy and average
  time-to-correct fed through the §5 chord-score formula — accuracy scaled by
  the speed ramp — mapped to the same letter thresholds as the chord-stats
  grade, so session and per-chord grades mean the same thing, and a session's
  letter reads on the same round seconds (§7.5). Note the top of the scale is
  literal: an S session is a flawless one averaging under a second. Song sessions have no time samples → full speed credit, exactly
  as §5 scores such combos. Learn sessions are stats-neutral (§5): no grade, no
  accuracy/speed cards — just prompts played, active time, and the goal line.
- **Headline**: the line beside the badge follows that letter rather than a
  threshold of its own, so the words and the grade can't disagree — praise at the
  top of the scale ("Flawless session!" for an S), encouragement at the bottom
  ("Tough one — come back at it"). A hollow "Nice session!" over a D is worse than
  nothing, and the weak session is the one that most needs a reason to start
  another. Ungraded sessions (Learn, or nothing recorded) keep their plain line.
- **Stat cards**: session *First-try accuracy* and *Avg time-to-correct*, each
  with a **delta vs the trailing baseline** — the mean over the last **30
  practiced days** (days with ≥ 1 counted prompt, from the daily records,
  excluding today); no baseline data → no delta shown. Plus lifetime **Total
  prompts** and **Total time**, each with this session's increment. Every judged
  prompt ticks the day's count, Song bars included, so a session's increment and
  the lifetime total it sits beside describe the same population. The avg-time
  baseline divides the day's summed time by its **timed** prompts (§8) rather
  than by all of them, so clock-paced bars — which contribute no time — can't
  drag it toward zero; a day of nothing but Song bars counts toward the accuracy
  baseline and sits out the time one.
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
  prompts ever reached, across all sessions). The accuracy trend divides by the
  day's prompts, the time trend by its **timed** prompts (§8); a day with
  prompts but no time samples (Song only) is a gap in the time chart, not a zero.
- **The grade (S–F)**, used here, on Home's In play row and in the session
  report, is the §5 chord score in letters. Both of its axes are stated in the
  units the player reads and both step one letter at a time, so the letter is
  predictable rather than the output of a curve — **a second costs a letter, and
  so does a miss**:
  - **Speed** — at flawless recent accuracy: **S ≤ 1 s, A ≤ 2 s, B ≤ 3 s,
    C ≤ 4 s, D ≤ 5 s**, F beyond. Faster than 1 s is never a bonus.
  - **Accuracy** — the recent window is 10 outcomes (§5), so the evenly spaced cut
    points land on its buckets two at a time: **10/10 → S, 8/10 → A, 6/10 → B,
    4/10 → C, 2/10 → D**, 0/10 → F. Since the score multiplies the axes, accuracy
    alone caps the letter: one miss in the window can't grade S however fast the
    answers were.
  - **Color**, one tier map behind every grade surface: **S blue** (the top of
    the scale, deliberately rare), **A/B green**, **C/D neutral**, **F red**.
    Red is F alone, because D is the §5.1 pass — a letter that unlocks the next
    chords can't read the same as the one that doesn't. The §7.3 slow flash sits
    at the same F boundary but stays **amber**, deliberately: one rep is a
    warning about pace, while the red letter is a verdict on a window of them.
  - **`new`** replaces the letter where a combo would grade F but hasn't reached
    the §5 evidence floor — a below-floor F is arithmetic, not a verdict, and the
    missing reps are what produced it. Neutral, never red, for that reason. Only
    the F is hidden: a below-floor **D still shows its letter**, because passing is
    its own proof (§5.1) and the badge must never contradict the `★ learned` pill
    beside it. Display only — the score underneath is the floored one, so §5
    weighting keeps drilling the combo and the pass gate keeps reading the real
    letter. A chord folds to `new` only when nothing *proven* is failing: one
    proven F still reads red however many unproven combos sit beside it.
  - So an **S means flawless and inside a second** — the top of the scale is
    literal and deliberately hard, with A as the ordinary "doing well" letter.
    §5's no-history baseline sits at that same top score (an untouched combo is
    treated as S-equivalent, neither penalized nor favored); a combo that has been
    played but not yet to the floor sits below it, since its unplayed reps count
    against it.
- A **chord stats** drill-down (its own screen, linked from Progress)
  lists every practiced combo — not just the top-3 worst/most-improved — with a letter
  **grade** (S–F, from the combo's chord score, §5), attempts, lifetime and recent
  accuracy, and lifetime and recent avg time-to-correct, sortable by any column. Both
  *recent* windows are the last 10, though they are capped independently (§5 outcomes,
  §8 time samples) and need not stay equal. The accuracy *column* reports the plain
  ratio over reps actually played — the evidence floor shapes the grade, not the
  percentage beside it. Sorting the grade column sorts on the score behind it, so a
  `new` row sits where its real number puts it.

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

The one architectural rule: **`theory/`, `practice/`, and `storage/` are pure
TypeScript with no DOM or MIDI dependencies.** All matching, weighting, goal/streak
and persistence logic lives there and is unit-tested directly; only `midi/`,
`audio/`, `components/` and `store/` touch the platform, and MIDI input is simulated
for development without hardware. `ls src/` is the authority on what modules exist.

The persisted shapes, which the sections above depend on:

Per-combo stat record (keyed `(root, typeId, voicingId)`, §5): attempts, first-try
successes, recent-miss window (the last **10** outcomes), time-to-correct samples
(the last 20). The outcome window widened from 5 to 10 in 9.5.0 without a schema
bump: records written under the narrower one are short, not invalid, and simply
fill up from there. Daily record: date, active
minutes, prompts (every judged prompt, Song bars included), first-try successes,
**timed prompts** (those carrying a time sample, i.e. prompts minus the day's Song
bars) and the day's summed time-to-correct ms — the Progress trends (§7.5) and the
Report's trailing-30-practiced-day baselines (§7.4) read these. `timedPrompts` was
added within schema v2: absent in earlier states, where every counted prompt was
self-paced, so it defaults to that day's `prompts` and no migration is needed.
Preset progress record (keyed by preset id,
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
