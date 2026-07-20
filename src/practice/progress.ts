// Flashcard-style unlock progress (DESIGN.md §5): a preset starts with only
// its first few chords in play, and more unlock once every unlocked chord is
// passed — a first-try success under the fast-time threshold. Pure TS; the
// persisted record lives in storage/ and the store applies the gating.

import type { Combo } from './combos'
import type { PromptOutcome } from './stats'
import type { ChordTypeId, PitchClass } from '../theory'

// A fresh preset opens with this many chords unlocked (clamped to the pool).
export const INITIAL_UNLOCK_COUNT = 3

// How many chords each completed unlock step adds.
export const UNLOCK_BATCH_SIZE = 2

// A first-try success at or under this time-to-correct passes the chord.
export const FAST_TIME_MS = 2000

// Progress is tracked per chord (root + type, across all its voicing
// combos), keyed like comboKey minus the voicing.
export function poolChordKey(chord: {
  root: PitchClass
  typeId: ChordTypeId
}): string {
  return `${chord.root}:${chord.typeId}`
}

// How the unlock queue is ordered (§5.1): 'pool' follows the pool's own
// order; 'fifths' reorders roots along the circle of fifths (C → G → D …),
// for root-ordered pools where chromatic neighbors aren't the musical ones.
export type UnlockOrderMode = 'pool' | 'fifths'

// Circle-of-fifths position of a pitch class: C=0, G=1, D=2 … F=11.
function fifthsIndex(pc: number): number {
  return (pc * 7) % 12
}

// The unlock order: the pool's own order (§4/§5), reconstructed from the
// expansion rather than poolChords() so chords with no satisfiable combo —
// which can never be attempted, hence never passed — don't occupy (and
// permanently block) an unlock slot. Combos of one chord are contiguous in
// an expansion, so first-occurrence dedup preserves pool order exactly.
// 'fifths' mode then stable-sorts by root, keeping one root's chords in
// their pool order relative to each other.
export function chordOrderOf(
  combos: readonly Combo[],
  mode: UnlockOrderMode = 'pool',
): string[] {
  const seen = new Set<string>()
  const chords: { key: string; root: number }[] = []
  for (const combo of combos) {
    const key = poolChordKey(combo)
    if (!seen.has(key)) {
      seen.add(key)
      chords.push({ key, root: combo.root })
    }
  }
  if (mode === 'fifths') {
    chords.sort((a, b) => fifthsIndex(a.root) - fifthsIndex(b.root))
  }
  return chords.map((chord) => chord.key)
}

// Persisted per preset id (§8). Passed chords are stored as *indices* into
// the chord order, not chord identity, so the diatonic preset's progress
// means "scale degree N" and survives a key change (§5). The field is still
// named masteredIndices in the persisted JSON — renaming it would need a
// schema migration for existing users, disproportionate for a wording-only
// change (the concept itself is just "passed", see FAST_TIME_MS).
export interface PresetProgressRecord {
  unlockedCount: number
  masteredIndices: number[] // sorted ascending, each < unlockedCount
}

export function initialProgress(totalChords: number): PresetProgressRecord {
  return {
    unlockedCount: Math.min(INITIAL_UNLOCK_COUNT, Math.max(totalChords, 1)),
    masteredIndices: [],
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
  return { unlockedCount, masteredIndices }
}

// The unlocked chords as poolChordKeys, for filtering an expansion's combos.
export function unlockedChordKeys(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
): ReadonlySet<string> {
  return new Set(chordOrder.slice(0, record.unlockedCount))
}

// The unlocked chords that are *not yet* passed, as poolChordKeys — for
// Learn mode's "not passed only" setting (§5.1/§7), which narrows
// generation to chords still being learned within the unlocked set.
export function notPassedChordKeys(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
): ReadonlySet<string> {
  const passed = new Set(record.masteredIndices)
  return new Set(
    chordOrder
      .slice(0, record.unlockedCount)
      .filter((_, index) => !passed.has(index)),
  )
}

// Per-chord status (§7 unlock chip drill-down): every pool chord in unlock
// order, tagged locked/unlocked/passed — the same three states the
// generator itself gates on, just surfaced instead of aggregated into counts.
export interface ChordPassEntry {
  key: string
  unlocked: boolean
  passed: boolean
}

export function chordPassList(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
): ChordPassEntry[] {
  const passed = new Set(record.masteredIndices)
  return chordOrder.map((key, index) => ({
    key,
    unlocked: index < record.unlockedCount,
    passed: passed.has(index),
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

// Feeds one Practice-mode outcome into the record. Only a fast first-try
// success on a not-yet-passed unlocked chord changes anything; passing
// the last outstanding chord unlocks the next batch (§5).
export function recordChordAttempt(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  chordKey: string,
  outcome: PromptOutcome,
  timeToCorrectMs: number,
): ProgressUpdate {
  const unchanged: ProgressUpdate = {
    record,
    changed: false,
    justUnlocked: false,
  }
  if (outcome !== 'first-try' || timeToCorrectMs > FAST_TIME_MS) {
    return unchanged
  }
  const index = chordOrder.indexOf(chordKey)
  if (index < 0 || index >= record.unlockedCount) return unchanged
  if (record.masteredIndices.includes(index)) return unchanged
  const masteredIndices = [...record.masteredIndices, index].sort(
    (a, b) => a - b,
  )
  const unlockedInPool = Math.min(record.unlockedCount, chordOrder.length)
  const allPassed = masteredIndices.length >= unlockedInPool
  const canGrow = record.unlockedCount < chordOrder.length
  const unlockedCount =
    allPassed && canGrow
      ? Math.min(record.unlockedCount + UNLOCK_BATCH_SIZE, chordOrder.length)
      : record.unlockedCount
  return {
    record: { unlockedCount, masteredIndices },
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
