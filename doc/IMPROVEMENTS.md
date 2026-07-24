# Improvements

Findings from a review of the 2026-07-20 commits (5716e00..1f152ba: Learn
not-passed-only toggle, combo streak, chord stats page, chord score/grade,
unlock-chip breakdown). None are functional bugs; ordered by priority.

## 1. "Combo" naming collision

`Combo` is the core domain type — a `(root, typeId, voicingId)` triple — while
`comboStreak` / `bestComboStreak` / `PersistedBestCombo` mean a fighting-game
hit streak. `PersistedBestCombo` sits next to `PersistedComboStats` in
`src/storage/persistedStats.ts` and reads like "the best (root, type, voicing)
combo". The History UI has the same ambiguity: "Best streak" (days) and "Best
combo" (prompts) side by side with no units.

- [ ] Rename the streak concept in code (e.g. `firstTryStreak`,
      `PersistedBestStreak`); keep only the persisted `bestComboStreak` JSON
      key (same pragmatic call as `masteredIndices`).
- [ ] Add a unit or tooltip to the History "Best combo" stat.

## 2. "Best time" can be won by a single lucky rep

The comment on `bestAvgTimeToCorrectMs` (`src/practice/session.ts`) claims the
per-chord average means "one lucky rep on an easy chord can't win best" — but a
chord attempted exactly once in the session has that one rep as its average.

- [ ] Gate the stat on ≥2 session attempts for that chord, or soften the
      comment.

## 3. Grades are noisy at low sample counts

`comboMetrics` (`src/practice/stats.ts`) grades every persisted combo, so one
missed attempt shows an immediate F on the chord stats page. The pattern for
the fix already exists: `IMPROVED_MIN_ATTEMPTS = 5` gates "most improved".

- [ ] Show "—" instead of a grade below a small attempt floor. (Weighting is
      unaffected — low-evidence swings there are fine and self-correcting.)

## 4. Streak quietly survives mode detours

`setMode` doesn't reset `comboStreak`, so a Practice streak pauses through a
Learn/Song excursion and resumes after — Learn records no misses, so a detour
can never break it. DESIGN.md §7 only says it resets on "any miss".

- [ ] Either reset the streak on mode switch or note the behavior in the spec.

## Smaller cleanups

- [ ] `src/practice/stats.ts` — `comboMetrics` recomputes the recent time
      average that `recentHistoryOf` already returned as
      `recent.avgTimeToCorrectMs`; drop the duplicate slice/average.
- [ ] `src/components/PromptCard.tsx` — the streak display threshold `10` is a
      magic number inline; DESIGN.md documents it, so export a named constant
      like the other tuning knobs.
- [ ] `src/components/ChordStatsView.tsx` — sortable headers don't set
      `aria-sort`.
- [ ] `src/components/UnlockChip.tsx` — popover has no Escape-to-close and no
      `aria-haspopup`/`aria-controls`; the backdrop button handles outside
      clicks but not keyboard users.
- [ ] `src/components/UnlockChip.tsx` — calls the store's `chordPassStatus()`
      during render; it only re-renders because the `progress` snapshot happens
      to change on every pass. Derive the list from subscribed state (or note
      the dependency) so the coupling isn't implicit.
