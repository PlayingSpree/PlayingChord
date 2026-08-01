import { describe, expect, it } from 'vitest'
import {
  defaultLearnSelection,
  isLearnSetComplete,
  learnFillerChords,
  learnPoolChordKeys,
  rehearsedChords,
  sanitizeLearnSelection,
  selectableLearnChords,
} from './learnLoop'
import type { PresetProgressRecord } from './progress'
import type { ComboGrade } from './stats'

// Six chords in unlock order, named a…f so the assertions read as order rather
// than as pitch — the loop never looks at what a chord key spells.
const ORDER = ['a', 'b', 'c', 'd', 'e', 'f']

const record = (
  unlockedCount: number,
  masteredIndices: number[] = [],
  setAsideIndices: number[] = [],
): PresetProgressRecord => ({
  unlockedCount,
  masteredIndices,
  setAsideIndices,
})

describe('selectableLearnChords (§5.4)', () => {
  it('offers the in-play chords only', () => {
    const entries = selectableLearnChords(ORDER, record(4, [0], [1]))
    expect(entries.map((e) => e.key)).toEqual(['a', 'c', 'd'])
  })
})

describe('defaultLearnSelection (§5.4)', () => {
  it('preselects the in-play chords not yet passed', () => {
    expect(defaultLearnSelection(ORDER, record(4, [0, 1]))).toEqual(['c', 'd'])
  })

  it('leaves out a set-aside chord even though it is unpassed', () => {
    expect(defaultLearnSelection(ORDER, record(4, [0], [2]))).toEqual([
      'b',
      'd',
    ])
  })

  it('falls back to the last three when everything in play is passed', () => {
    const all = record(5, [0, 1, 2, 3, 4])
    expect(defaultLearnSelection(ORDER, all)).toEqual(['c', 'd', 'e'])
  })

  it('falls back to what exists when fewer than three are in play', () => {
    expect(defaultLearnSelection(ORDER, record(2, [0, 1]))).toEqual(['a', 'b'])
  })
})

describe('sanitizeLearnSelection (§5.4)', () => {
  it('drops keys that are no longer selectable and restores unlock order', () => {
    const selection = ['d', 'a', 'zz', 'b']
    expect(
      sanitizeLearnSelection(ORDER, record(4, [], [1]), selection),
    ).toEqual(['a', 'd'])
  })

  it('deduplicates', () => {
    expect(sanitizeLearnSelection(ORDER, record(3), ['a', 'a'])).toEqual(['a'])
  })
})

describe('learnFillerChords (§5.4)', () => {
  it('pads a short selection with learned chords, most recent first', () => {
    // a…d passed, e still being learned: e alone needs two companions, and it
    // gets the two chords passed nearest to it.
    expect(learnFillerChords(ORDER, record(5, [0, 1, 2, 3]), ['e'])).toEqual([
      'd',
      'c',
    ])
  })

  it('adds nothing once the selection reaches the floor', () => {
    const rec = record(5, [0, 1])
    expect(learnFillerChords(ORDER, rec, ['c', 'd', 'e'])).toEqual([])
  })

  it('never pads with a chord that is still being learned', () => {
    // Only `a` is passed, so `e` gets one companion and stays under the floor
    // rather than dealing the chords the player declined.
    expect(learnFillerChords(ORDER, record(5, [0]), ['e'])).toEqual(['a'])
  })

  it('never pads with a set-aside chord (§5.2)', () => {
    expect(learnFillerChords(ORDER, record(4, [0, 1], [1]), ['d'])).toEqual([
      'a',
    ])
  })

  it('does not count a selected chord as its own filler', () => {
    expect(learnFillerChords(ORDER, record(3, [0, 1, 2]), ['c'])).toEqual([
      'b',
      'a',
    ])
  })
})

describe('learnPoolChordKeys (§5.4)', () => {
  it('is the selection plus its filler', () => {
    const pool = learnPoolChordKeys(ORDER, record(5, [0, 1, 2, 3]), ['e'])
    expect([...pool].sort()).toEqual(['c', 'd', 'e'])
  })

  it('is the selection alone when it already meets the floor', () => {
    const pool = learnPoolChordKeys(ORDER, record(5, [0]), ['b', 'c', 'd', 'e'])
    expect([...pool].sort()).toEqual(['b', 'c', 'd', 'e'])
  })
})

describe('rehearsedChords / isLearnSetComplete (§5.4)', () => {
  const grades = (map: Record<string, ComboGrade>) => (key: string) =>
    map[key] ?? null

  it('counts a selected chord at D or better', () => {
    const done = rehearsedChords(['a', 'b', 'c'], grades({ a: 'D', b: 'S' }))
    expect([...done].sort()).toEqual(['a', 'b'])
  })

  it('does not count F, and does not count a chord with no reps', () => {
    const done = rehearsedChords(['a', 'b'], grades({ a: 'F' }))
    expect([...done]).toEqual([])
  })

  it('completes only when every selected chord is rehearsed', () => {
    const selection = ['a', 'b']
    expect(isLearnSetComplete(selection, new Set(['a']))).toBe(false)
    expect(isLearnSetComplete(selection, new Set(['a', 'b']))).toBe(true)
  })

  it('is not completed by filler reaching the bar', () => {
    // `c` is filler — rehearsing it says nothing about the selection.
    expect(isLearnSetComplete(['a', 'b'], new Set(['a', 'c']))).toBe(false)
  })

  it('is never complete with an empty selection', () => {
    expect(isLearnSetComplete([], new Set())).toBe(false)
  })
})
