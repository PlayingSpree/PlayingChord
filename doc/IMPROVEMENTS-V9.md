# Improvements

Findings from a review of the 2026-07-20 commits (5716e00..1f152ba: Learn
not-passed-only toggle, combo streak, chord stats page, chord score/grade,
unlock-chip breakdown). None are functional bugs; ordered by priority.

## 1. "Combo" naming collision

`Combo` is the core domain type — a `(root, typeId, voicingId)` triple — while
`comboStreak` / `bestComboStreak` / `PersistedBestCombo` mean a rhythm-game hit
streak. `PersistedBestCombo` sits next to `PersistedComboStats` in
`src/storage/persistedStats.ts` and reads like "the best (root, type, voicing)
combo". The History UI has the same ambiguity: "Best streak" (days) and "Best
combo" (prompts) side by side with no units.

- [x] Rename the streak concept in code (`firstTryStreak`,
      `PersistedBestStreak`); keep only the persisted `bestComboStreak` JSON
      key (same pragmatic call as `masteredIndices`). The UI keeps the word
      *combo* — it's the spec's product name (§7.3, §7.5).
- [x] Add a unit or tooltip to the History "Best combo" stat. (Already done:
      Progress reads "Best combo streak: N first-try in a row".)

## 2. "Best time" can be won by a single lucky rep

The comment on `bestAvgTimeToCorrectMs` (`src/practice/session.ts`) claims the
per-chord average means "one lucky rep on an easy chord can't win best" — but a
chord attempted exactly once in the session has that one rep as its average.

- [x] Gate the stat on ≥2 session attempts for that chord, or soften the
      comment. Resolved by deleting the stat (9.3.0): it, `slowest` and `worst`
      were computed and typed but never rendered — the v9 Report dropped them
      and the spec never noticed.

## 3. Grades are noisy at low sample counts

`comboMetrics` (`src/practice/stats.ts`) grades every persisted combo, so one
missed attempt shows an immediate F on the chord stats page. The pattern for
the fix already exists: `IMPROVED_MIN_ATTEMPTS = 5` gates "most improved".

- [x] Show "—" instead of a grade below a small attempt floor. (Weighting is
      unaffected — low-evidence swings there are fine and self-correcting.)
      Fixed differently in 9.5.0, because 9.2.0 put the grade in charge of
      unlocking and a display-only floor would have left the pass gate, Home's
      chips and the `★ learned` pill each needing their own answer. Instead the
      *score* gained an evidence floor — unplayed reps count as misses — which
      fixes the noise at both ends (a lucky rep no longer grades S or passes a
      chord), and `new` stands in for the letter only where an F isn't yet
      earned. Weighting inherits the floor deliberately: one number, one meaning.

## 4. Streak quietly survives mode detours

`setMode` doesn't reset `comboStreak`, so a Practice streak pauses through a
Learn/Song excursion and resumes after — Learn records no misses, so a detour
can never break it. DESIGN.md §7 only says it resets on "any miss".

- [x] Either reset the streak on mode switch or note the behavior in the spec.
      Reset (9.4.0). Narrower than it read here: session start/end already
      zeroed the streak, so only within-session detours were affected.

## Smaller cleanups

- [x] `src/practice/stats.ts` — `comboMetrics` recomputes the recent time
      average that `recentHistoryOf` already returned as
      `recent.avgTimeToCorrectMs`; drop the duplicate slice/average.
- [x] `src/components/PromptCard.tsx` — the streak display threshold `10` is a
      magic number inline; DESIGN.md documents it, so export a named constant
      like the other tuning knobs. (Already done: `FIRST_TRY_STREAK_DISPLAY_MIN`.)
- [x] `src/components/ChordStatsView.tsx` — sortable headers don't set
      `aria-sort`.
- [~] `src/components/UnlockChip.tsx` — popover keyboard handling. Obsolete:
      the v9 shell folded the chip into `HomeView`; the component is gone.
- [~] `src/components/UnlockChip.tsx` — `chordPassStatus()` called during
      render. Obsolete with the component; `HomeView` now calls it inside a
      `useMemo` with the implicit dependency spelled out in a comment.
