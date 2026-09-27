import { describe, expect, it } from 'vitest'
import {
  dailyChordCount,
  dailyLegMinutes,
  dailyLegRemaining,
  dailyPool,
  dueDailyLeg,
  type DailyPlan,
  type DailyPresetSource,
} from './daily'
import type { ChordCombo, Side } from './combos'
import type { PitchClass } from '../theory'

const combo = (
  root: PitchClass,
  typeId: 'maj' | 'min' = 'maj',
  voicingId = 'any',
): ChordCombo => ({ root, typeId, voicingId })

// A source whose chord order is its combos' chords in order, with the given
// indices passed — the shape reloadProgress hands the store.
const source = (
  combos: readonly ChordCombo[],
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

describe('daily legs (§5.3)', () => {
  const both = { chords: 12, scales: 3 }
  const none = { chords: 0, scales: 0 }
  const plan = (
    capMinutes: number,
    chordShare: number,
    learned: Record<Side, number> = both,
    playedToday: Record<Side, number> = none,
  ): DailyPlan => ({ capMinutes, chordShare, learned, playedToday })

  it('splits the cap by the chord share, the scale leg taking the rest', () => {
    expect(dailyLegMinutes('chords', plan(10, 0.5))).toBe(5)
    expect(dailyLegMinutes('scales', plan(10, 0.5))).toBe(5)
    expect(dailyLegMinutes('chords', plan(20, 0.75))).toBe(15)
    expect(dailyLegMinutes('scales', plan(20, 0.75))).toBe(5)
    // Fractional legs are kept, not rounded: the clock is in active ms.
    expect(dailyLegMinutes('chords', plan(5, 0.25))).toBe(1.25)
  })

  it('gives the whole cap to the only side with anything learned', () => {
    const chordsOnly = plan(10, 0.25, { chords: 4, scales: 0 })
    expect(dailyLegMinutes('chords', chordsOnly)).toBe(10)
    expect(dailyLegMinutes('scales', chordsOnly)).toBe(0)
    expect(dueDailyLeg(chordsOnly)).toBe('chords')

    const scalesOnly = plan(10, 0.5, { chords: 0, scales: 2 })
    expect(dueDailyLeg(scalesOnly)).toBe('scales')
    expect(dailyLegMinutes('scales', scalesOnly)).toBe(10)
  })

  it('runs chords then scales, skipping a leg its share turns off', () => {
    expect(dueDailyLeg(plan(10, 0.5))).toBe('chords')
    expect(dueDailyLeg(plan(10, 0))).toBe('scales') // all scales
    expect(dueDailyLeg(plan(10, 1, both, { chords: 10, scales: 0 }))).toBeNull()
  })

  it('takes off what today already played, resuming a leg cut short', () => {
    const cutShort = plan(10, 0.5, both, { chords: 3, scales: 0 })
    expect(dailyLegRemaining('chords', cutShort)).toBe(2)
    expect(dueDailyLeg(cutShort)).toBe('chords')

    const chordsDone = plan(10, 0.5, both, { chords: 5.2, scales: 0 })
    expect(dailyLegRemaining('chords', chordsDone)).toBe(0)
    expect(dueDailyLeg(chordsDone)).toBe('scales')

    expect(
      dueDailyLeg(plan(10, 0.5, both, { chords: 5, scales: 5 })),
    ).toBeNull()
  })

  it('counts a leg within ten seconds of its share as done', () => {
    // A leg ends at the first advance past its share — or a breath short of
    // it on End — and a few seconds left is not a session worth dealing.
    const almost = plan(10, 0.5, both, { chords: 5 - 5 / 60, scales: 0 })
    expect(dailyLegRemaining('chords', almost)).toBe(0)
    expect(dueDailyLeg(almost)).toBe('scales')
  })

  it('has no leg to run with nothing learned anywhere', () => {
    expect(dueDailyLeg(plan(10, 0.5, none))).toBeNull()
  })
})
