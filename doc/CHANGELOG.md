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
