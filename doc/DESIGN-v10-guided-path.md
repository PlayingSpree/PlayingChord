# PlayingChord v10 — Guided Path (design draft)

**Status: draft.** This document designs the v10 *guided path* — the "Completely new
loop" from IDEA.md, which absorbs the practice-loop split and the learning loop and
makes the preset revamp unnecessary. It is written against DESIGN.md **v9.10.0**;
section references (§) point there. When implemented, this content merges into
DESIGN.md as spec **10.0.0** (a MAJOR bump — it changes the app's top-level loop and
retires per-preset unlocking) with a CHANGELOG entry; until then DESIGN.md stays the
authority on what the app *is*.

---

## 1. The reframe

In v9 the user assembles every session by hand: preset × mode × length (§7.2). That
puts the pedagogy on the player — *which* preset, *when* to move from Learn to
Practice, *when* a new batch is due — which is exactly the part a beginner can't do
yet.

v10 inverts it. A single **path** — a fixed, ordered sequence of **chapters** — knows
where the player is, and Home's primary button always does the right next thing:
learn the new chords, then practice everything learned, then play the song. The
player makes one decision (press the button), not four.

Everything current survives underneath as **Free practice**: the v9 session sheet
(preset, Learn/Practice/Song, length) unchanged, but **ungated** — presets deal from
their full pool. The path owns progression; free practice is just practice.

The theory, matching, stats and grading layers (§3, §5, §6) barely move. The path is
a new *generation policy* plus a Home/session-flow rework, one new persisted record
and one new preset-pool variant.

---

## 2. Chapters

A chapter is a small batch of *new material* — chords, or a voicing skill applied to
known chords — plus, for key chapters, a **song checkpoint**. Two chapter kinds:

- **Key chapter** — the diatonic triads of one major key that the player doesn't
  already have (dim excluded until its own skill chapter).
- **Skill chapter** — a voicing or chord-quality skill applied to already-learned
  roots: inversions, LH root bass, dominant 7ths, sus, …

### 2.1 Key ordering and the +2 property

Key chapters follow the circle of fifths from C, alternating sharp/flat sides —
which is both the classic pedagogy order and, roughly, key commonness. After C,
**every key contributes exactly 2 new chords**, because the rest of its diatonic set
was already learned:

| # | Key | New chords | Cumulative |
|---|-----|-----------|------------|
| 1 | C | C, F, G, Am, Dm, Em | 6 |
| 2 | G | D, Bm | 8 |
| 3 | F | B♭, Gm | 10 |
| 4 | D | A, F♯m | 12 |
| 5 | A | E, C♯m | 14 |
| 6 | E | B, G♯m | 16 |
| 7 | B♭ | E♭, Cm | 18 |
| 8 | E♭ | A♭, Fm | 20 |
| 9 | A♭ | D♭, B♭m | 22 |
| 10 | D♭ | G♭, E♭m | 24 |

Ten key chapters cover all 24 major and minor triads (enharmonics fold by pitch
class, §3.1 — G♭ ≡ F♯, E♭m ≡ D♯m). The batch size of 2 matches the v9 unlock batch
(§5.1), and each key's **song checkpoint reuses old chords in the new context** —
G's I–IV–V is G–C–D, one new chord and two old — so review is built into the
structure instead of bolted on.

Minor *keys* are not chapters: the relative-minor chords arrive with their major key
anyway, and Song's diatonic generation is major-key only (§6.5). Revisit only if a
minor-key song chapter is wanted later.

### 2.2 Skill chapters and where extensions fit

Extensions and voicings are **skill chapters interleaved between key chapters**,
applied to roots the player already knows — never new-chord unlocks. This answers
IDEA.md's "how to fit 7th sus dim add9": they are depth on known material, not
breadth.

The v10 track (key chapters bold):

1. **Key of C** — root position
2. Inversions in C — 1st/2nd inversion of the C chords, displayed with **slash
   names** (C/E *is* first inversion — the slash chord is the notation for the
   skill, not separate content; this resolves IDEA.md's slash-chord question)
3. **Key of G**
4. **Key of F**
5. Dominant 7 — the V7 of the learned keys: G7, D7, C7
6. **Key of D**
7. **Key of A**
8. LH root bass — a pattern rule (§3.3), LH `1` / RH `1-3-5`, over the primary
   chords of the learned keys (IDEA.md's "advanced path" entry point)
9. **Key of E**
10. **Key of B♭**
11. sus2 / sus4 — on C, F, G, D, A
12. **Key of E♭**
13. **Key of A♭**
14. Diminished — the vii° of the learned keys, closing the diatonic set
15. **Key of D♭**
16. maj7 / min7 — Imaj7 / ii-7 / vi-7 of the common keys

The track past chapter ~8 is provisional — the shape (keys interleaved with skills,
each skill over already-known roots) is the decision; the exact roster tunes freely
because chapters are **data**, like chord types and voicing rules (§3.3): an ordered
list of chapter definitions in `src/practice/`, each declaring its combos. Extended
9/11/13 chords stay out of the path entirely — they remain free-practice material,
matched literally per §3.2.

### 2.3 Combos and batches

A chapter's content is, concretely, **combos** — the same `(root, typeId, voicingId)`
key everything already uses (§5, §8). A key chapter's combos are its new chords ×
the chapter's voicing (root position for chapter 1; `any` once inversions are
learned — see §5.3 below). A skill chapter's combos are known chords × the new rule
(e.g. C × `first-inversion`).

Within a chapter, combos are dealt to the learning loop in **batches of at most 3**
— the same width a fresh v9 preset opens with (§5.1), enough to alternate between,
small enough to hold in the head. Chapter 1 is two deliberate batches: **C, F, G**
(the primary chords — I–IV–V of C — playable music after the very first batch),
then **Am, Dm, Em**. Key chapters 2+ are a single batch of 2. Skill chapters split
their combo list into 3s in declared order.

A batch opens when the previous batch is fully passed; a chapter opens when the
previous chapter is. **Passing is per combo, and it is the v9 bar unchanged**
(§5.1): a Practice-counted attempt after which the combo's grade is D or better,
evidence floor included (~2 clean reps at an ordinary pace), latched forever.

---

## 3. The two loops

The path runs on two session types, which are IDEA.md's two loop ideas made into
the path's verbs. Both reuse the v9 attempt lifecycle (§6.2), hints (§6.4),
matching (§6.3) and grading (§7.5) unchanged.

### 3.1 Learning loop

**Pool:** the current batch's not-yet-passed combos. Nothing else — passed chords
don't dilute the batch (IDEA.md: "don't count the stat for passed chord, that still
need practice mode" — review is daily practice's job, below).

**Deal:** each combo's *first* prompt of the session is an **intro rep** — the
example voicing overlaid on the keyboard from the start, Learn-style, stats-neutral
(§5's Learn rule applies to the rep, not the session). Every later rep of that combo
is a normal hidden Practice rep: counted, graded, hint-escalated. So one session
carries a chord from *shown* to *recalled* without a mode switch — the v9
Learn-then-Practice choreography the user had to perform by hand becomes a
per-prompt tag on the generated prompt.

**End:** the session ends itself when every combo in the batch is passed — that's
the session's length; the length picker (§7.2) doesn't apply. The End button works
as always, and progress persists (passes latch per rep, §5.1), so quitting mid-batch
loses nothing. The Stage's center readout is the batch itself: each combo as a chip
with its live grade, `★` stamping on as it passes — the §7.3 grade-up line and
`★ learned` callout carry over as-is.

**The pool never narrows to one:** as batch combos pass, a pool of only-unpassed
combos would shrink to a single chord dealt on repeat — massed repetition, which
is both the weakest way to fix a shaky chord and the fastest way to make a session
feel stuck. So the learning pool is **backfilled to 3 wide**: the batch's unpassed
combos first, then the batch's already-passed combos, then the wider learned
repertoire (§3.2's pool), clamped to what exists — only chapter 1's very first
batch can come up short, and it opens 3 wide anyway. Unpassed combos are weighted
so roughly **two of every three prompts** are batch material, and §5's no-repeat
exclusion (now always `min(3, poolSize − 1)` = 2) keeps a combo from landing twice
inside three prompts. The last stubborn chord gets drilled *interleaved* rather
than back-to-back, which is also the better-retention shape.

Backfill reps are ordinary Practice reps — counted, graded, hint-escalated — but
never intro reps: the intro rep above belongs to batch combos only, since backfill
material is by definition already passed. The end condition is untouched: the
session ends when every combo *in the batch* is passed; backfill can neither
extend nor block it.

### 3.2 Daily practice

**Not a new session type.** Daily practice is the v9 session (§7.2) — Practice
mode, length ∞ — run on one derived built-in preset, **Repertoire**, whose pool is
every passed combo on the path. The Today card starts it in one press (no sheet),
and it also sits in the free-practice picker like any other preset, so a player can
run the same pool at any mode or length. It is derived, not authored: it can't be
edited or deleted, and it grows itself — each pass adds its combo, a pool change
like any other, which rebuilds the upcoming-preview queue (§5).

**Pool:** every **passed** combo across the whole path, dealt with the v9 §5
weighted pick unchanged — recent misses and slow answers pull a combo forward, so
"worst chords only" needs no toggle: the bias is the default and the pool is the
whole learned repertoire. Available as soon as at least one combo is passed.

The pool is a list of **full combos** — chord *and* voicing — because the path's
material varies per chord (C in first inversion, G still root position only), which
no product/explicit/diatonic pool (§4) can express. §4 gains one pool variant,
**`combos`**, for exactly this; it is the shape `pathProgress` already stores, so
the preset is a projection of the record rather than a second source of truth.

**Length:** ∞, paced by the daily goal — and v9 already does this, so there is
nothing to add: an ∞ session's Stage bar tracks today's goal minutes and flips to
`🔥 Streak safe` once met (§7.3, §7.6). Nothing auto-ends at the goal; the player
ends when they're done, which also means "another 10 min" needs no mechanism —
the session simply never stopped. The goal paces a sitting, it doesn't ration the
day.

**Stats:** counted, exactly as v9 Practice. Passes can still happen here (§5.1
latches on any counted rep), so a batch chord that got close in the learning loop
can finish passing during practice — the loops share one grading truth.

### 3.3 Song checkpoint

Each **key chapter** carries a song: v9 Song mode (§6.5) pinned to the chapter's
key — diatonic pool, starts on I, no vii°, metronome, phrase loops. Completing one
full phrase **stamps** the chapter (a 🎵 badge on the chapter and the Report).

**The stamp does not gate.** The next chapter opens when the batch passes,
whether or not the song was played. Song is clock-paced and the most stressful
mode; blocking progression on it would punish exactly the players the path exists
for. The stamp is the celebration and the nudge — Home offers the song as the
day's next step (below) until it's stamped, then stops asking.

Skill chapters have **no song in v10** — Song voices everything with `any` (§6.5),
so an inversion or pattern skill has nothing to check. Revisit alongside §6.5's
deferred "honor the preset's voicing rules".

---

## 4. UI

### 4.1 Home: the Today card

The Continue card (§7.1) becomes the **Today card** — the path's face and the one
primary button. Its state machine, first match wins:

1. **Batch in learning** → `Learn C, F & G` — the current batch's chips with live
   grades (`new` / letters, §7.5), `★` on passed ones.
2. **Daily goal not met** → `Practice` with the goal ring on the card
   (`6 / 10 min`) — the button starts the Repertoire ∞ session, the ring is the
   Stage bar it will show.
3. **Current or previous key chapter unstamped** → `🎵 Play the song in G`.
4. **All done today** → `Extra practice` — the same session again; the streak is
   safe and the card says so.

One button, but not a lock: the other steps stay reachable as secondary actions on
the card (a player who wants to skip straight to the song, can). The card also
shows the chapter name and the path position (`Chapter 3 of 16 · 8/24 chords`).

The **In play row** (§7.1) survives as the *repertoire* row — every learned chord
with its grade, set-aside chords dimmed (§5.2 semantics unchanged, floor of 3
applying to the daily-practice pool) — with the 🔒 disclosure now opening the
**path map**.

### 4.2 Path map

A screen (from Home) listing every chapter in order: done (with grades and 🎵
stamp), current (batch progress), locked (named, so "what's coming" stays
answerable — the same job §5.1's locked-chip disclosure did). Locked chapters are
visible but not startable; there is **no manual early unlock** in v10 — the
calibration below is the sanctioned fast lane, and §5.2's open-early control
retires with per-preset unlocking.

### 4.3 Free practice

A secondary card under the Today card: the v9 session sheet unchanged — preset
picker (built-ins, custom, and the derived **Repertoire** preset, §3.2/§4), Learn /
Practice / Song, length 10/20/40/∞, worst-chords-only kept here (it's the only
place left that isn't already biased). No unlock gate: presets deal their full pool. Stats record to the same per-combo
records, so free practice sharpens the same grades the path reads — a combo passed
anywhere is passed.

### 4.4 Stage & Report

The Stage (§7.3) gains one center readout: the learning loop shows the batch chips
in place of the `done / length` bar. Daily practice needs nothing new — it *is*
v9's ∞ session, so it already shows the goal bar. The Report (§7.4) is unchanged except the unlock banner becomes the
**chapter banner**: batch complete → names the next batch; chapter complete → the
chapter celebration, offering the song when unstamped. The set-aside offer (§5.2)
carries over against the daily-practice pool.

---

## 5. Progression mechanics & migration

### 5.1 Persistence

One new record, `pathProgress` (schema v3): the per-chapter passed-combo flags
(indices into the chapter's declared combo list, the same indices-not-identities
choice as §5.1), the set-aside indices, and the per-chapter 🎵 stamp. Current
chapter and batch are derived, not stored — the first not-fully-passed position.
The Repertoire preset (§3.2) is derived too: its `combos` pool is the record's
passed flags projected through the chapter definitions, recomputed on load and on
each pass, never persisted separately. Chapter definitions are static data, so a
future track edit reconciles the same way a shrunk custom preset does (§5.1):
clamp, never crash.

Per-preset unlock records (§5.1/§8) are **retired**: left in storage, ignored (the
same tolerance the schema has always practiced — old fields read, never trusted to
exist). The circle-of-fifths setting retires with them — the path's order *is*
circle-of-fifths and is not a setting.

### 5.2 Calibration (onboarding & migration in one)

On first entry to the path (fresh v10 install *or* upgrade from v9), every chapter
combo whose existing stat record **already grades D or better with the evidence
floor met** (§5, §7.5) is marked passed. That's IDEA.md's "preset calibration"
Minor idea folded in as the path's front door:

- A v9 upgrader's history fast-passes what they've provably learned — chapters
  they've outgrown collapse on load, and the path opens at their real frontier.
- A fresh install passes nothing and starts at chapter 1, batch 1.

The bar is deliberately the pass bar itself, not a special calibration drill — one
grading truth, and no new mechanism. A player who *knows* chords the app has never
seen them play still walks through the early batches, but at ~2 clean reps per
combo (§5.1) a known batch is under a minute; an explicit placement drill is
deferred until that proves too slow in practice.

### 5.3 Voicing over the path's life

Chapter 1 drills **root position** — the canonical shape, and what the example
voicing teaches anyway. After the Inversions chapter is passed, the *C-chord*
combos' daily-practice presence includes the inversion combos, and new key
chapters from then on drill **`any`** (the player has the concept; the name is the
prompt, §3.4). Skill-chapter combos (inversions, patterns, 7ths) join daily
practice as themselves — stats were per-combo all along (§5), so none of this is
new bookkeeping.

---

## 6. What v10 retires

The payoff — each of these disappears *because the path covers its job*:

- **Per-preset unlocking** (§5.1, most of it): one global path record replaces
  per-preset records, reconciliation, reset-per-preset, and the unlock toast's
  per-preset framing. Reset progress becomes a single "reset path" (Settings).
- **Circle-of-fifths setting** (§5.1): the path's fixed order.
- **"Not passed only"** (Learn, §5.1): the learning loop *is* not-passed-only.
- **"Worst chords only"** (Practice, §5): absorbed by daily practice's default
  weighting; survives only as a free-practice toggle.
- **Manual early unlock** (§5.2): calibration is the fast lane.
- **Preset revamp** (IDEA.md Major #3): dropped — presets only serve free
  practice now, and the v9 editor (§7.6) is sufficient for that.
- **The mode decision itself**, for the guided flow: Learn vs Practice becomes a
  per-prompt tag inside the learning loop; the player never chooses.

Set-aside (§5.2), goals/streaks (§7.6), the ∞ session and its goal bar (§7.3),
grading (§7.5), matching (§6.3), hints (§6.4), the Report's stat definitions (§7.4)
and all of `theory/` carry over unchanged. Note what v10 does *not* add: daily
practice is a preset, not a session type, so the only genuinely new session
behavior in the path is the learning loop.

---

## 7. Open questions

1. **Chapter-1 batch order** — primary chords first (C,F,G then Am,Dm,Em, as
   specified) vs. mixed batches. Primary-first is the recommendation: playable
   I–IV–V music after the first batch is the strongest possible day-one hook. (Answer: Primary-first)
2. **Does the Today card need a fourth state for "behind on review"?** Deferred
   with the decay mechanism (§3.1 hook) — until decay exists, nothing can fall
   behind. (Answer: Defer until decay exists)
3. **Skill-chapter songs** — deferred with §6.5's voicing-rule honoring; revisit
   together.
4. **Track roster past chapter 8** (§2.2) — provisional by design; tune as data
   once real players hit it.
