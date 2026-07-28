// Flashcard-style unlock progress (DESIGN.md §5): a preset starts with only
// its first few chords in play, and more unlock once every unlocked chord is
// passed — its grade risen to D or better (§5.1). The player can also open and
// close chords by hand (§5.2): setting one aside holds it out of play and out
// of the unlock gate. Pure TS; the persisted record lives in storage/ and the
// store applies the gating.

import { isPassingGrade, type ComboGrade } from './stats'
import type { Combo } from './combos'
import type { ChordTypeId, PitchClass } from '../theory'

// A fresh preset opens with this many chords unlocked (clamped to the pool).
export const INITIAL_UNLOCK_COUNT = 3

// How many chords each completed unlock step adds.
export const UNLOCK_BATCH_SIZE = 2

// How few chords setting one aside (§5.2) may leave in play. A drill needs
// something to alternate between, and the same number a fresh preset opens
// with is the smallest pool the app ever deals from — so a preset can't be
// whittled below its own starting width. A pool at or under this size simply
// has nothing to set aside.
export const MIN_ACTIVE_CHORDS = 3

// Progress is tracked per chord (root + type, across all its voicing
// combos), keyed like comboKey minus the voicing.
export function poolChordKey(chord: {
  root: PitchClass
  typeId: ChordTypeId
}): string {
  return `${chord.root}:${chord.typeId}`
}

// The pool's own chord order (§4/§5), reconstructed from the expansion rather
// than poolChords() so chords with no satisfiable combo — which can never be
// attempted, hence never passed — don't occupy (and permanently block) a slot.
// Combos of one chord are contiguous in an expansion, so first-occurrence dedup
// preserves pool order exactly.
//
// The circle-of-fifths alternative retired with v10: the *path* walks the circle
// of fifths (§2.1), so an ordering setting on top of a preset's own deliberate
// order had nothing left to be for.
export function chordOrderOf(combos: readonly Combo[]): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const combo of combos) {
    const key = poolChordKey(combo)
    if (!seen.has(key)) {
      seen.add(key)
      order.push(key)
    }
  }
  return order
}

// Persisted per preset id (§8). Passed chords are stored as *indices* into
// the chord order, not chord identity, so the diatonic preset's progress
// means "scale degree N" and survives a key change (§5). The field is still
// named masteredIndices in the persisted JSON — renaming it would need a
// schema migration for existing users, disproportionate for a wording-only
// change (the concept itself is just "passed", see recordChordAttempt).
export interface PresetProgressRecord {
  unlockedCount: number
  masteredIndices: number[] // sorted ascending, each < unlockedCount
  // Chords set aside by hand (§5.2): unlocked but held out of play, sorted
  // ascending, each < unlockedCount. Absent in early-v2 states, where it
  // defaults to empty rather than invalidating the record (§8).
  setAsideIndices: number[]
}

export function initialProgress(totalChords: number): PresetProgressRecord {
  return {
    unlockedCount: Math.min(INITIAL_UNLOCK_COUNT, Math.max(totalChords, 1)),
    masteredIndices: [],
    setAsideIndices: [],
  }
}

// Clamps a stored record to a pool's actual size — a custom preset's pool
// can shrink under its saved progress (library edit), and the sanitizer
// can't know pool sizes. Never below the initial count so a record can't
// pin a preset to fewer chords than a fresh start would give.
export function reconcileProgress(
  record: PresetProgressRecord,
  totalChords: number,
): PresetProgressRecord {
  const floor = initialProgress(totalChords).unlockedCount
  const unlockedCount = Math.min(
    Math.max(Math.floor(record.unlockedCount), floor),
    Math.max(totalChords, 1),
  )
  const masteredIndices = [...new Set(record.masteredIndices)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < unlockedCount)
    .sort((a, b) => a - b)
  // A shrinking pool can pull the unlock frontier back under the set-aside
  // list until too little is left in play (§5.2); the newest ones come back
  // first, since they were set aside against a pool that no longer exists.
  const setAsideIndices = [...new Set(record.setAsideIndices)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < unlockedCount)
    .sort((a, b) => a - b)
  const minActive = Math.min(MIN_ACTIVE_CHORDS, unlockedCount)
  while (unlockedCount - setAsideIndices.length < minActive) {
    setAsideIndices.pop()
  }
  return { unlockedCount, masteredIndices, setAsideIndices }
}

// The chords actually in play: unlocked and not set aside (§5.2). Every
// generation path filters by this, so a set-aside chord is out of Learn and
// Practice alike — and out of their narrows (worst-chords-only, not-passed-
// only), which draw from the already-filtered pool.
function activeIndices(record: PresetProgressRecord, limit: number): number[] {
  const aside = new Set(record.setAsideIndices)
  const active: number[] = []
  for (let i = 0; i < limit; i++) if (!aside.has(i)) active.push(i)
  return active
}

export function activeChordCount(record: PresetProgressRecord): number {
  return activeIndices(record, record.unlockedCount).length
}

export function isSetAside(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  chordKey: string,
): boolean {
  const index = chordOrder.indexOf(chordKey)
  return index >= 0 && record.setAsideIndices.includes(index)
}

// May this chord be set aside (§5.2)? Only an unlocked chord that is still in
// play, and only while doing so leaves MIN_ACTIVE_CHORDS behind. There is no
// cap on how many may be set aside at once — the floor is the whole limit.
export function canSetAside(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  chordKey: string,
): boolean {
  const index = chordOrder.indexOf(chordKey)
  if (index < 0 || index >= record.unlockedCount) return false
  if (record.setAsideIndices.includes(index)) return false
  return activeChordCount(record) - 1 >= MIN_ACTIVE_CHORDS
}

export function setAsideChord(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  chordKey: string,
): PresetProgressRecord {
  if (!canSetAside(chordOrder, record, chordKey)) return record
  const index = chordOrder.indexOf(chordKey)
  return {
    ...record,
    setAsideIndices: [...record.setAsideIndices, index].sort((a, b) => a - b),
  }
}

// Opens a chord for play, whichever way it is closed (§5.2) — the single
// action behind Home's *Bring back* and *Unlock now*. A set-aside chord drops
// off that list; a not-yet-reached one drags the unlock frontier forward to
// cover it, which opens every chord before it too (the frontier is a prefix,
// §5.1) — the caller says so on the control rather than doing it silently.
// Passing is untouched either way: a newly opened chord is unlocked and not
// yet passed, so the next automatic batch now waits on it.
export function openChord(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  chordKey: string,
): PresetProgressRecord {
  const index = chordOrder.indexOf(chordKey)
  if (index < 0) return record
  if (index >= record.unlockedCount) {
    return { ...record, unlockedCount: index + 1 }
  }
  if (!record.setAsideIndices.includes(index)) return record
  return {
    ...record,
    setAsideIndices: record.setAsideIndices.filter((i) => i !== index),
  }
}

// How many chords ahead of this one an *Unlock now* would open with it (§5.2),
// for the control's label. Zero for anything already unlocked.
export function chordsOpenedBefore(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  chordKey: string,
): number {
  const index = chordOrder.indexOf(chordKey)
  if (index < record.unlockedCount) return 0
  return index - record.unlockedCount
}

// The chords in play as poolChordKeys, for filtering an expansion's combos:
// unlocked and not set aside (§5.2).
export function unlockedChordKeys(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
): ReadonlySet<string> {
  const aside = new Set(record.setAsideIndices)
  return new Set(
    chordOrder.slice(0, record.unlockedCount).filter((_, i) => !aside.has(i)),
  )
}

// The in-play chords that are *not yet* passed, as poolChordKeys — for
// Learn mode's "not passed only" setting (§5.1/§7), which narrows
// generation to chords still being learned within the unlocked set.
export function notPassedChordKeys(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
): ReadonlySet<string> {
  const passed = new Set(record.masteredIndices)
  const aside = new Set(record.setAsideIndices)
  return new Set(
    chordOrder
      .slice(0, record.unlockedCount)
      .filter((_, index) => !passed.has(index) && !aside.has(index)),
  )
}

// Is this chord unlocked but not yet passed — still being learned (§5.1)? The
// same two conditions recordChordAttempt gates on before it looks at the grade,
// so the Stage can say a rep was the one that learned the chord (§7.3). Only
// reached for a chord that was just dealt, so it can't be one set aside.
export function isChordInLearning(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  chordKey: string,
): boolean {
  const index = chordOrder.indexOf(chordKey)
  if (index < 0 || index >= record.unlockedCount) return false
  return !record.masteredIndices.includes(index)
}

// Per-chord status (§7 unlock chip drill-down): every pool chord in unlock
// order, tagged locked/unlocked/passed/set-aside — the same states the
// generator itself gates on, just surfaced instead of aggregated into counts.
// `index` is the chord's place in the unlock order, which is what the §5.2
// controls act on.
export interface ChordPassEntry {
  key: string
  index: number
  unlocked: boolean
  passed: boolean
  setAside: boolean
}

export function chordPassList(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
): ChordPassEntry[] {
  const passed = new Set(record.masteredIndices)
  const aside = new Set(record.setAsideIndices)
  return chordOrder.map((key, index) => ({
    key,
    index,
    unlocked: index < record.unlockedCount,
    passed: passed.has(index),
    setAside: aside.has(index),
  }))
}

export function isFullyUnlocked(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
): boolean {
  return record.unlockedCount >= chordOrder.length
}

export interface ProgressUpdate {
  record: PresetProgressRecord
  changed: boolean
  // True when this attempt completed the unlocked set and opened new chords.
  justUnlocked: boolean
}

// Feeds one Practice-mode outcome into the record, as the chord's grade *after*
// that outcome was recorded (§5.1): a not-yet-passed unlocked chord whose grade
// has reached D passes, and passing the last outstanding chord unlocks the
// next batch (§5). The grade is the chord's, not one voicing's — the caller
// folds its combos together (worstChordGrade) — and null (no history at all,
// which an attempt just ruled out) never passes.
//
// Passing is a latch: a chord whose grade later falls back to F stays passed
// and its unlock stays open. The unlock queue is a ratchet — nothing the
// generator does takes back pool the player is mid-drill on — and the
// current grade is already reported live on Home and in Progress, so nothing is
// hidden by the latch. Only the player narrows the pool, by hand and outside a
// session (§5.2 set aside).
export function recordChordAttempt(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  chordKey: string,
  grade: ComboGrade | null,
): ProgressUpdate {
  const unchanged: ProgressUpdate = {
    record,
    changed: false,
    justUnlocked: false,
  }
  if (!isPassingGrade(grade)) return unchanged
  const index = chordOrder.indexOf(chordKey)
  if (index < 0 || index >= record.unlockedCount) return unchanged
  if (record.masteredIndices.includes(index)) return unchanged
  const masteredIndices = [...record.masteredIndices, index].sort(
    (a, b) => a - b,
  )
  const unlockedInPool = Math.min(record.unlockedCount, chordOrder.length)
  // Set-aside chords are held out of the gate as well as out of the pool
  // (§5.2): a chord you never see dealt can never be passed, so counting it
  // as outstanding would stall the queue for good — the opposite of what
  // setting it aside is for. The debt stays visible on Home instead.
  const passedSet = new Set(masteredIndices)
  const allPassed = activeIndices(record, unlockedInPool).every((i) =>
    passedSet.has(i),
  )
  const canGrow = record.unlockedCount < chordOrder.length
  const unlockedCount =
    allPassed && canGrow
      ? Math.min(record.unlockedCount + UNLOCK_BATCH_SIZE, chordOrder.length)
      : record.unlockedCount
  return {
    record: { ...record, unlockedCount, masteredIndices },
    changed: true,
    justUnlocked: unlockedCount > record.unlockedCount,
  }
}

// Convenience for the store: the unlocked subset of an expansion's combos.
export function filterUnlockedCombos(
  combos: readonly Combo[],
  unlocked: ReadonlySet<string>,
): readonly Combo[] {
  const filtered = combos.filter((combo) => unlocked.has(poolChordKey(combo)))
  // Defensive: an inconsistent record must never empty the pool —
  // nextPrompt() relies on a non-empty one (§5).
  return filtered.length > 0 ? filtered : combos
}
