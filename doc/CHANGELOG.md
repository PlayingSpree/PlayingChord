# Changelog

Spec versions for [DESIGN.md](DESIGN.md). The version is the **spec's**, not the
build's: `package.json` tracks it so a screenshot can be traced to the rules that
produced it.

- **MAJOR** — a structural rework of the domain model or the UI shell.
- **MINOR** — a product behavior change.
- **PATCH** — wording, clarification, or restructuring with no behavior change.

Versions 4.0.0–9.0.0 were labelled "Draft v4"–"Draft v9" in DESIGN.md's status
paragraph and are restated here with the commits that landed them. Drafts v1–v3
were conversation rounds that predate the document's first commit; they left no
artifact and are not recoverable.

---

## 9.11.0 — 2026-07-30

**Two ways to practice.** Practice splits into **Daily** and **Free** (§7.1,
§7.2, §7.3). Free is the old mode under a new name — a preset, its unlock gate,
its narrows, a chosen length. Daily is the drill that needs no choosing: every
chord already *passed*, in every preset at once, deduplicated by combo, run to a
persisted time cap (§5.3, new). The pool is drawn from passed chords for a
reason beyond the obvious one — everything in it is passed already and passing
is a latch, so daily practice can move no unlock queue and needs no rule saying
it doesn't. It still records per-combo stats, which is what makes it maintenance
rather than rehearsal: a chord that rots shows up in its grade and is weighted
back to the front. Chords set aside by hand (§5.2) stay out of it, and with
nothing learned yet the mode reads locked rather than dealing an empty session.
The Report's set-aside offer stays free-practice-only (§7.4): a cross-preset
session has no one preset for it to act on.

Session length gains a **unit** (§7.2). Prompts still offers 10/20/40/∞; minutes
offers 5/10/15/∞ and counts *active* time — the same clock the daily goal uses —
so a timed session can't run out while nobody is at the keyboard, and a length
is only ever checked between prompts, so it never cuts a rep off mid-attempt.
Daily's cap is always minutes and lives in settings rather than the session
draft: the point of a daily drill is that it is the same tomorrow.

## 9.10.0 — 2026-07-27

**Worst chords only, actually reachable.** The Practice toggle (§7.2) was gated
on a cached top-three worst list that only existed once a session had dealt a
prompt, so on a fresh load — which is exactly when the session sheet is opened —
it was always disabled, however many misses were on the record. It now asks the
question directly: would the worst-only pool (§5: missed combos plus not-yet-
passed chords) come out non-empty? Computed on demand from the persisted
records, so there is no cached copy to go stale, and asked of the preset
*drafted in the sheet* rather than the one the store is still on — the sheet's
picks don't reach the store until Start, and the old list answered for the
previous preset until then.

## 9.9.0 — 2026-07-27

**A chord you can put down.** Unlocking is no longer the only thing that decides
what you practice: any unlocked chord can be **set aside** by hand (§5.2) and
any locked one opened early, from an *Edit pool* toggle on Home's In play row
(§7.1). A set-aside chord stops being dealt in Learn and Practice, keeps its
stats and its grade, and — the decision the rest of it hangs on — is held out of
the §5.1 unlock gate as well as the pool. A chord that is never dealt can never
be passed, so counting it as outstanding would stall the queue for good, which
is the opposite of what benching a chord you can't play is for. The debt is
carried in the open instead: it sits dimmed on the In play row with its grade
still on it, and setting one aside must leave at least three chords in play, the
width a fresh preset starts at. There is no other cap — setting aside is triage,
and curating which chords you practice for good is what a custom preset is for.
Opening a locked chord drags the unlock frontier over everything before it, as a
prefix must, and says so on the control; nothing about it grants a pass.

The Report (§7.4) makes the offer at the moment there's evidence for it: a
session that graded F *and* played a chord currently graded F gets a card naming
that chord, and a session graded A or better with something benched gets the
mirror. A card in the flow rather than a modal over it — an F session already
gets an encouraging headline by design, and a dialog demanding a decision on top
of that reads as the app telling you to give up.

## 9.8.0 — 2026-07-27

**No way past a chord, and one line for grade news.** The Skip button is gone
(§6.2, §7.3): a prompt is now left only by answering it or by ending the
session. A costless way out gets taken on exactly the chords the drill exists
for, and the §5 weighting can only work from reps that happened — a skipped
chord looked untouched rather than hard, so it came back no more often than any
other. Nothing else changes: accuracy and the unlock gate already ignored skips,
so their definitions simply lost a clause.

The **`★ learned`** callout (§5.1) moved off the feedback pill and onto the
grade-up line under it (§7.3). Both are the same news at two scales — this combo
climbed a letter, this chord is no longer failing — and they land on the same
rep almost every time, so the pill is now purely the speed report and the line
beneath it carries the grades.

## 9.7.0 — 2026-07-27

**Ten seconds is a miss, and a climb is news once.** A rep that reaches the §6.2
recording ceiling now enters the *grade* window as a miss: the speed axis was
already zero there, but accuracy read the prompt as flawless, so a combo that
was hunted down over ten seconds could still grade well above what it had shown.
Only the grade demotes it — lifetime accuracy, the session tallies, the Report
log, the daily figures and the combo streak still count the first-try success
the player actually played.

The §7.3 grade-up notice moved from a toast on its own timer to a line under the
feedback pill, decided on the same judgment edge as the `learned` callout, so it
appears with the ✔ of the rep that earned it instead of after that prompt is
gone. It also fires once per letter per session, per combo: a grade rides a
moving window, so a combo sitting on a cut point re-crosses it every few reps
and the same B → A announced itself repeatedly.

The Report headline (§7.4) reads off the session grade instead of an accuracy
threshold of its own: praise at the top of the scale, encouragement at the
bottom, so the line and the badge beside it always agree.

## 9.6.0 — 2026-07-27

**A build says which build it is.** Home's top bar carries the spec version
next to the wordmark, and names the branch when the build didn't come from
`master`.

Previews now deploy to the production URL (README, *Deployment*) — the repo has
one Pages site, so testing a branch replaces the live build until it's re-run
from `master`. Without a marker on screen there is nothing to distinguish the
two, and a screenshot can't be traced to the rules that produced it, which is
the reason `package.json` tracks the spec version at all. The branch is hidden
on production builds, where it would be noise. Both values are substituted at
build time.

---

## 9.5.1 — 2026-07-27

**The document stops restating the code.** No behavior change: DESIGN.md's job is
now the decisions and their rationale, not the type declarations.

The inline `interface` blocks in §3.2/§3.3/§3.4/§4, §2's stack table and §8's
directory tree are replaced by prose plus a pointer to the source file. They were
the parts that had already drifted — §3.2 still declared `intervals: number[]` after
each interval gained its spelling degree, and §3.3 declared one `VoicingRule`
interface after the type became a constraint/pattern union — while the surrounding
rationale stayed accurate, because a stale explanation gets noticed and a stale
field list doesn't. What a reader can recover by opening the file is the cheapest
thing to maintain and the least valuable to duplicate; what §5's evidence floor is
half of, and why, is neither.

---

## 9.5.0 — 2026-07-27

**A grade now has to be earned.** Two changes to the §5 chord score, and one to
how it's shown.

The **recent window widens from 5 to 10** outcomes, so a letter takes two misses
to move and no single rep flips a grade. Ten keeps every cut point landing exactly
on a bucket of the window.

An **evidence floor** divides accuracy by 5 until the window holds that many —
the reps a combo hasn't played count as misses. At one recorded outcome the letter
used to be meaningless in both directions: a lone miss graded F, and a lone lucky
rep graded S *and passed the chord* (§5.1), which is the bar 9.2.0 was raising.
Passing is now about two clean reps at an ordinary pace, or one inside S's second
where a single rep is unambiguous. The floor is 5 — the old window — so **no
already-practiced combo changes grade**; it bites only on new ones. It applies
wherever the score does, so grade, weighting and pass can't disagree.

**`new`** replaces the letter where a combo would grade F but hasn't reached the
floor (§7.5) — neutral, never red, because a below-floor F is arithmetic rather
than a verdict. A below-floor D still shows its letter: passing is its own proof,
and the badge must never contradict the `★ learned` pill beside it.

## 9.4.0 — 2026-07-27

**Switching mode ends the combo streak** (§7.3). Only Practice can break a
streak — Learn records no outcome and Song is clock-paced — so a mid-session
detour used to park the count and hand it back intact, a free pass on a
counter that nothing else forgives.

## 9.3.0 — 2026-07-27

The Report drops its **secondary chord lines** — best chord average, slowest
chords, worst chords (§7.4). They were specified for the v5 summary modal and
never rebuilt into the v9 Report, so the spec has been describing three lines
the screen doesn't have. Rather than build them: **Still shaky** already names
the session's missed chords with counts, and the chord stats page ranks slowest
across every session instead of one noisy sample.

## 9.2.0 — 2026-07-26

The grade takes charge of unlocking. A chord is **passed once its grade is D or
better** (§5.1), replacing the one-fast-first-try bar. The pill gains a **`· fast`
chip** (A's second, the mirror of `· slow`) and a **`learned`** callout on the rep
that lifts a chord past the pass bar (§7.3). Red moves with it: **F alone is red**,
D reads neutral like C (§7.5), while the slow flash keeps its amber at the
unchanged F boundary.

Landed in `227f122` alongside 9.1.0 — one commit, two revisions.

## 9.1.0 — 2026-07-26

Grade restated in **round seconds** with an **S** tier on top (§7.5): S ≤ 1 s, A 2 s,
B 3 s, C 4 s, D 5 s at flawless accuracy, a miss costing a letter exactly as a second
does. The old A–D bands keep their seconds and are relabeled one letter down, so a
returning player's chords read a letter higher without having changed; the one
substantive move is 4–5 s (and 1-of-5 accuracy), previously F, now D. Adds the §7.3
**`· slow` chip** on answers past D's second and the §6.2 **time-to-correct ceiling**
(10 s) on everything recorded.

Landed in `227f122`.

## 9.0.0 — 2026-07-24 → 07-25

**Session-based UI.** The app opens on a **Home** screen and practice runs as explicit
sessions: a session sheet picks preset, mode, and a **length in prompts** (10/20/40/∞,
replacing the v5 minute timer), the **Stage** runs the session, and every session ends
in a full-screen **Report** with a session grade (the §5 chord-score formula applied to
the session) and deltas against a trailing-30-practiced-day baseline (§7). History
becomes **Progress**, the upcoming preview shrinks to the next 2 shown inline, and the
visual language is redone (reference mock: `Prototype.dc.html`).

Built out across three commits: `d8875eb` (spec + docs moved into `doc/`), `2315221`
(sessions confined to the Stage, Song bars counted — §7.2, §7.4), `35ad2a0` (first
prompt gated, feedback backlog cleared — §5, §7.1, §7.3).

## 8.3.0 — 2026-07-20

Unlock concept renamed from "mastered" to **passed** throughout — a bar well short of
real mastery (see §5.1). Adds a per-chord breakdown to the unlock chip, expandable by
clicking it (§5.1, §7). `1f152ba`

## 8.2.0 — 2026-07-20

Learn-mode **"Not passed only"** setting, mirroring Practice's worst-chords toggle,
narrowing generation to unlocked-but-not-yet-passed chords (§5.1, §7). `5716e00`

## 8.1.0 — 2026-07-19

Optional **circle-of-fifths unlock order** for root-ordered pools, and an unlock
**toast** naming the newly opened chords (§5.1, §7). `5c786a7`

## 8.0.0 — 2026-07-19

Flashcard-style **chord unlocking**: each preset starts with only its first 3 chords in
play, and passing every unlocked chord opens 2 more, until the whole pool is available
(§5). Learn/Practice generate only from unlocked chords; Song mode stays full-pool.
`a76d88e`

## 7.0.0 — 2026-07-18

Song mode draws its progression from the **active preset's chord pool** instead of a
separate key selection, so all three modes share one preset picker; a diatonic preset
keeps the starts-on-I / no-vii° / Roman-numeral behavior (§6.5). `a076544`

## 6.0.0 — 2026-07-18

**Song mode**: a third session mode that plays a short progression to a metronome,
where the clock advances instead of waiting for a correct answer (§6.5). Adds the
key-press piano synth and the upcoming-chord preview (§7, §9). `eca6b0d`

DESIGN.md dates this revision 2026-07-17, the day it was decided; it landed 07-18.

## 5.0.0 — 2026-07-16

Session modes reworked into **Learn** (example voicing visible, untimed) and
**Practice** (voicing hidden), with the former timed/review modes folded into
Practice-mode settings. `f8d3571`

## 4.0.0 — 2026-07-15

First committed spec. Refines prompt emphasis, judging model, hint policy,
goals/streaks, sound policy, extended-chord stance, and no-device behavior; both
previously open questions resolved (§9). `8432cab`
