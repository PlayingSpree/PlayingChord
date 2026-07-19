// Flashcard-style unlock progress (DESIGN.md §5): a preset starts with only
// its first few chords in play, and more unlock once every unlocked chord is
// mastered — a first-try success under the fast-time threshold. Pure TS; the
// persisted record lives in storage/ and the store applies the gating.

import type { Combo } from './combos'
import type { PromptOutcome } from './stats'
import type { ChordTypeId, PitchClass } from '../theory'

// A fresh preset opens with this many chords unlocked (clamped to the pool).
export const INITIAL_UNLOCK_COUNT = 3

// How many chords each completed unlock step adds.
export const UNLOCK_BATCH_SIZE = 2

// A first-try success at or under this time-to-correct masters the chord.
export const FAST_TIME_MS = 2000

// Progress is tracked per chord (root + type, across all its voicing
// combos), keyed like comboKey minus the voicing.
export function poolChordKey(chord: {
  root: PitchClass
  typeId: ChordTypeId
}): string {
  return `${chord.root}:${chord.typeId}`
}

// The unlock order: the pool's own order (§4/§5), reconstructed from the
// expansion rather than poolChords() so chords with no satisfiable combo —
// which can never be attempted, hence never mastered — don't occupy (and
// permanently block) an unlock slot. Combos of one chord are contiguous in
// an expansion, so first-occurrence dedup preserves pool order exactly.
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

// Persisted per preset id (§8). Mastered chords are stored as *indices* into
// the chord order, not chord identity, so the diatonic preset's progress
// means "scale degree N" and survives a key change (§5).
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
// success on a not-yet-mastered unlocked chord changes anything; mastering
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
  const allMastered = masteredIndices.length >= unlockedInPool
  const canGrow = record.unlockedCount < chordOrder.length
  const unlockedCount =
    allMastered && canGrow
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
