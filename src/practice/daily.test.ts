import { describe, expect, it } from 'vitest'
import { dailyChordCount, dailyPool, type DailyPresetSource } from './daily'
import type { Combo } from './combos'
import type { PitchClass } from '../theory'

const combo = (
  root: PitchClass,
  typeId: 'maj' | 'min' = 'maj',
  voicingId = 'any',
): Combo => ({ root, typeId, voicingId })

// A source whose chord order is its combos' chords in order, with the given
// indices passed — the shape reloadProgress hands the store.
const source = (
  combos: readonly Combo[],
  masteredIndices: number[],
  setAsideIndices: number[] = [],
): DailyPresetSource => {
  const chordOrder: string[] = []
  for (const c of combos) {
    const key = `${c.root}:${c.typeId}`
    if (!chordOrder.includes(key)) chordOrder.push(key)
  }
  return {
    combos,
    chordOrder,
    record: {
      unlockedCount: chordOrder.length,
      masteredIndices,
      setAsideIndices,
    },
  }
}

describe('dailyPool (§5.3)', () => {
  it('draws only passed chords', () => {
    const pool = dailyPool([source([combo(0), combo(2), combo(4)], [0, 2])])
    expect(pool).toEqual([combo(0), combo(4)])
  })

  it('unions across presets, in source order', () => {
    const pool = dailyPool([
      source([combo(0), combo(2)], [1]),
      source([combo(5, 'min'), combo(7, 'min')], [0]),
    ])
    expect(pool).toEqual([combo(2), combo(5, 'min')])
  })

  it('deduplicates a combo two presets share', () => {
    const pool = dailyPool([
      source([combo(0)], [0]),
      source([combo(0), combo(3)], [0, 1]),
    ])
    expect(pool).toEqual([combo(0), combo(3)])
  })

  it('keeps the same chord under different voicings apart', () => {
    const pool = dailyPool([
      source([combo(0, 'maj', 'first-inversion')], [0]),
      source([combo(0, 'maj', 'second-inversion')], [0]),
    ])
    expect(pool).toHaveLength(2)
    expect(dailyChordCount(pool)).toBe(1) // …but it is one chord
  })

  it('leaves out a passed chord that was set aside (§5.2)', () => {
    const pool = dailyPool([source([combo(0), combo(2)], [0, 1], [1])])
    expect(pool).toEqual([combo(0)])
  })

  it('is empty when nothing has been passed anywhere', () => {
    expect(dailyPool([source([combo(0), combo(2)], [])])).toEqual([])
    expect(dailyPool([])).toEqual([])
  })

  it('ignores a passed index the order no longer has', () => {
    // A record reconciled against a shrunken pool can't produce this, but a
    // display path must never read undefined as a chord key.
    expect(dailyPool([source([combo(0)], [0, 7])])).toEqual([combo(0)])
  })
})
