import { describe, expect, it } from 'vitest'
import { ALL_PITCH_CLASSES } from '../theory'
import type { Combo } from './combos'
import {
  chordOrderOf,
  FAST_TIME_MS,
  filterUnlockedCombos,
  INITIAL_UNLOCK_COUNT,
  initialProgress,
  isFullyUnlocked,
  poolChordKey,
  recordChordAttempt,
  reconcileProgress,
  UNLOCK_BATCH_SIZE,
  unlockedChordKeys,
  type PresetProgressRecord,
} from './progress'

// A pool of `size` major chords with contiguous voicing combos each, like a
// real expansion (poolChords × voicingIds).
function combosOf(size: number, voicingIds: string[] = ['any']): Combo[] {
  return ALL_PITCH_CLASSES.slice(0, size).flatMap((root) =>
    voicingIds.map((voicingId) => ({
      root,
      typeId: 'maj' as const,
      voicingId,
    })),
  )
}

function orderOf(size: number): string[] {
  return chordOrderOf(combosOf(size))
}

// Masters every unlocked chord except the given indices.
function masteredExcept(
  record: PresetProgressRecord,
  ...except: number[]
): PresetProgressRecord {
  return {
    ...record,
    masteredIndices: Array.from(
      { length: record.unlockedCount },
      (_, i) => i,
    ).filter((i) => !except.includes(i)),
  }
}

describe('chordOrderOf (§5 unlock order)', () => {
  it('dedupes voicing combos to first-occurrence chord order', () => {
    const combos = combosOf(3, ['first-inversion', 'second-inversion'])
    expect(chordOrderOf(combos)).toEqual(['0:maj', '1:maj', '2:maj'])
  })

  it('keys chords by root and type, ignoring voicing', () => {
    expect(poolChordKey({ root: 4, typeId: 'min7' })).toBe('4:min7')
  })

  it('fifths mode reorders all 12 roots along the circle of fifths', () => {
    expect(chordOrderOf(combosOf(12), 'fifths')).toEqual(
      [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5].map((root) => `${root}:maj`),
    )
  })

  it('fifths mode keeps one root’s chord types in pool order', () => {
    const combos: Combo[] = ([0, 2, 7] as const).flatMap((root) =>
      (['maj', 'min'] as const).map((typeId) => ({
        root,
        typeId,
        voicingId: 'any',
      })),
    )
    expect(chordOrderOf(combos, 'fifths')).toEqual([
      '0:maj',
      '0:min',
      '7:maj',
      '7:min',
      '2:maj',
      '2:min',
    ])
  })
})

describe('initialProgress / reconcileProgress (§5)', () => {
  it('starts with the first 3 chords unlocked', () => {
    expect(initialProgress(12)).toEqual({
      unlockedCount: INITIAL_UNLOCK_COUNT,
      masteredIndices: [],
    })
  })

  it('clamps the initial unlock to a smaller pool', () => {
    expect(initialProgress(2).unlockedCount).toBe(2)
    expect(initialProgress(1).unlockedCount).toBe(1)
  })

  it('reconcile clamps unlockedCount to a shrunk pool', () => {
    const record: PresetProgressRecord = {
      unlockedCount: 9,
      masteredIndices: [0, 5, 8],
    }
    expect(reconcileProgress(record, 6)).toEqual({
      unlockedCount: 6,
      masteredIndices: [0, 5],
    })
  })

  it('reconcile never drops below a fresh start', () => {
    const record: PresetProgressRecord = {
      unlockedCount: 1,
      masteredIndices: [0],
    }
    expect(reconcileProgress(record, 12).unlockedCount).toBe(
      INITIAL_UNLOCK_COUNT,
    )
  })

  it('reconcile dedupes and sorts mastered indices', () => {
    const record: PresetProgressRecord = {
      unlockedCount: 5,
      masteredIndices: [3, 1, 3, 0],
    }
    expect(reconcileProgress(record, 12).masteredIndices).toEqual([0, 1, 3])
  })
})

describe('unlockedChordKeys / filterUnlockedCombos (§5 gating)', () => {
  it('exposes only the first unlockedCount chords', () => {
    const order = orderOf(6)
    const unlocked = unlockedChordKeys(order, initialProgress(6))
    expect([...unlocked]).toEqual(['0:maj', '1:maj', '2:maj'])
  })

  it('filters an expansion down to unlocked combos', () => {
    const combos = combosOf(6, ['first-inversion', 'second-inversion'])
    const unlocked = unlockedChordKeys(chordOrderOf(combos), initialProgress(6))
    const filtered = filterUnlockedCombos(combos, unlocked)
    expect(filtered).toHaveLength(6) // 3 chords × 2 voicings
    expect(filtered.every((c) => unlocked.has(poolChordKey(c)))).toBe(true)
  })

  it('falls back to the whole pool rather than returning empty', () => {
    const combos = combosOf(3)
    expect(filterUnlockedCombos(combos, new Set())).toEqual(combos)
  })

  it('isFullyUnlocked once the count covers the pool', () => {
    const order = orderOf(3)
    expect(isFullyUnlocked(order, initialProgress(3))).toBe(true)
    expect(isFullyUnlocked(orderOf(4), initialProgress(4))).toBe(false)
  })
})

describe('recordChordAttempt (§5 mastery and unlocking)', () => {
  const order = orderOf(12)
  const fresh = initialProgress(12)

  it('a fast first-try masters the chord', () => {
    const { record, changed, justUnlocked } = recordChordAttempt(
      order,
      fresh,
      '0:maj',
      'first-try',
      FAST_TIME_MS,
    )
    expect(changed).toBe(true)
    expect(justUnlocked).toBe(false)
    expect(record.masteredIndices).toEqual([0])
    expect(record.unlockedCount).toBe(INITIAL_UNLOCK_COUNT)
  })

  it('a miss does not count', () => {
    const update = recordChordAttempt(order, fresh, '0:maj', 'missed', 500)
    expect(update.changed).toBe(false)
    expect(update.record).toBe(fresh)
  })

  it('a slow first-try does not count', () => {
    const update = recordChordAttempt(
      order,
      fresh,
      '0:maj',
      'first-try',
      FAST_TIME_MS + 1,
    )
    expect(update.changed).toBe(false)
  })

  it('a locked or unknown chord does not count', () => {
    expect(
      recordChordAttempt(order, fresh, '5:maj', 'first-try', 100).changed,
    ).toBe(false)
    expect(
      recordChordAttempt(order, fresh, '0:min', 'first-try', 100).changed,
    ).toBe(false)
  })

  it('an already-mastered chord is a no-op', () => {
    const once = recordChordAttempt(order, fresh, '1:maj', 'first-try', 100)
    const twice = recordChordAttempt(
      order,
      once.record,
      '1:maj',
      'first-try',
      100,
    )
    expect(twice.changed).toBe(false)
  })

  it('mastering fewer than all unlocked chords does not unlock', () => {
    const record = masteredExcept(fresh, 1, 2)
    const update = recordChordAttempt(order, record, '1:maj', 'first-try', 100)
    expect(update.record.unlockedCount).toBe(INITIAL_UNLOCK_COUNT)
    expect(update.justUnlocked).toBe(false)
  })

  it('mastering the last unlocked chord unlocks the next batch', () => {
    const record = masteredExcept(fresh, 2)
    const update = recordChordAttempt(order, record, '2:maj', 'first-try', 100)
    expect(update.justUnlocked).toBe(true)
    expect(update.record.unlockedCount).toBe(
      INITIAL_UNLOCK_COUNT + UNLOCK_BATCH_SIZE,
    )
    expect(update.record.masteredIndices).toEqual([0, 1, 2])
  })

  it('unlocking clamps at the end of the pool', () => {
    const order4 = orderOf(4)
    const record = masteredExcept(initialProgress(4), 2)
    const update = recordChordAttempt(order4, record, '2:maj', 'first-try', 100)
    expect(update.justUnlocked).toBe(true)
    expect(update.record.unlockedCount).toBe(4)
  })

  it('a fully-unlocked pool still records mastery but never grows', () => {
    const order3 = orderOf(3)
    const record = masteredExcept(initialProgress(3), 2)
    const update = recordChordAttempt(order3, record, '2:maj', 'first-try', 100)
    expect(update.changed).toBe(true)
    expect(update.justUnlocked).toBe(false)
    expect(update.record.unlockedCount).toBe(3)
  })
})
