// The learn loop (DESIGN.md §5.4): pick a few chords, drill them until each one
// grades D or better, then the session is over. Pure TS — this decides which
// chords the loop deals and when it is finished; the store owns the session-local
// stats the grades come from.
//
// Two things it deliberately does not do. It never writes progress: a chord
// brought up here is **rehearsed**, not passed (§5.1), so nothing it does opens
// the next unlock batch or joins the daily pool. And it grades only what the
// player chose — the filler chords below are dealt for company, never for credit.

import { isPassingGrade, type ComboGrade } from './stats'
import {
  chordPassList,
  MIN_ACTIVE_CHORDS,
  type ChordPassEntry,
  type PresetProgressRecord,
} from './progress'

// The chords the picker may offer (§5.4): everything in play — unlocked and not
// set aside. A benched chord is out of Learn like it is out of everything else
// (§5.2), so it never appears to be ticked back on from here.
export function selectableLearnChords(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
): ChordPassEntry[] {
  return chordPassList(chordOrder, record).filter(
    (entry) => entry.unlocked && !entry.setAside,
  )
}

// What the sheet opens with (§5.4): the in-play chords not yet passed — the
// chords the unlock frontier has handed over and is now waiting on, which is
// what "learn the new ones" means. When everything in play is already passed
// there is nothing waiting, so it falls back to the most recently reached
// chords rather than leaving the mode unstartable.
export function defaultLearnSelection(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
): string[] {
  const selectable = selectableLearnChords(chordOrder, record)
  const notPassed = selectable.filter((entry) => !entry.passed)
  const fallback = selectable.slice(-MIN_ACTIVE_CHORDS)
  return (notPassed.length > 0 ? notPassed : fallback).map((entry) => entry.key)
}

// Drops anything no longer selectable and restores unlock order — the drafted
// selection outlives a preset or key change in the sheet, and a stale key must
// never reach generation. An empty result is meaningful (nothing left to learn),
// and is what disables Start.
export function sanitizeLearnSelection(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  selection: readonly string[],
): string[] {
  const wanted = new Set(selection)
  return selectableLearnChords(chordOrder, record)
    .filter((entry) => wanted.has(entry.key))
    .map((entry) => entry.key)
}

// The chords the loop deals: the selection, padded to MIN_ACTIVE_CHORDS with
// chords already learned (§5.4). The floor is §5.2's, for §5.2's reason — a
// drill needs something to alternate between, and the no-immediate-repeat
// exclusion is min(3, pool − 1), so a one-chord set would otherwise be the same
// prompt over and over. Filler is drawn in *reverse* unlock order: the chords
// learned most recently are the ones that sit next to what is being learned now.
//
// Only passed chords fill — an unselected chord that is still being learned is a
// chord the player just declined to work on, and dealing it anyway would make
// the selection a suggestion. If the preset has too few passed chords to reach
// the floor, the pool is simply narrower; it is never padded with something that
// isn't learned.
export function learnFillerChords(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  selection: readonly string[],
): string[] {
  const selected = new Set(selection)
  const shortfall = MIN_ACTIVE_CHORDS - selected.size
  if (shortfall <= 0) return []
  return selectableLearnChords(chordOrder, record)
    .filter((entry) => entry.passed && !selected.has(entry.key))
    .reverse()
    .slice(0, shortfall)
    .map((entry) => entry.key)
}

// Selection plus filler, as poolChordKeys — what generation filters the
// preset's combos down to.
export function learnPoolChordKeys(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  selection: readonly string[],
): ReadonlySet<string> {
  return new Set([
    ...selection,
    ...learnFillerChords(chordOrder, record, selection),
  ])
}

// The selected chords brought up to the pass bar this session (§5.4). The grade
// is the *session's* — the loop reads none of the lifetime record — and comes
// from the same D-or-better bar as §5.1, so "good enough to move on" means one
// thing across the app. A chord with no reps yet grades null and isn't rehearsed.
export function rehearsedChords(
  selection: readonly string[],
  gradeOf: (chordKey: string) => ComboGrade | null,
): ReadonlySet<string> {
  return new Set(selection.filter((key) => isPassingGrade(gradeOf(key))))
}

// Is the loop done? Only the selection counts — filler reaching D proves nothing
// the player asked for. An empty selection is never complete: the sheet won't
// start one, and treating it as finished would end the session on its first rep.
export function isLearnSetComplete(
  selection: readonly string[],
  rehearsed: ReadonlySet<string>,
): boolean {
  return selection.length > 0 && selection.every((key) => rehearsed.has(key))
}
