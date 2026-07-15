import { describe, expect, it } from 'vitest'
import {
  CHORD_TYPES,
  chordPitchClasses,
  chordToneAt,
  getChordType,
} from './chordTypes'

describe('CHORD_TYPES table', () => {
  it('contains exactly the 19 built-in types from DESIGN.md §3.2', () => {
    expect(CHORD_TYPES.map((t) => t.id).sort()).toEqual(
      [
        'maj',
        'min',
        'dim',
        'aug',
        'sus2',
        'sus4',
        'maj6',
        'min6',
        'add9',
        'maj7',
        'min7',
        'dom7',
        'dim7',
        'm7b5',
        'maj9',
        'min9',
        'dom9',
        'dom11',
        'dom13',
      ].sort(),
    )
  })

  it('every type starts at the root and ascends in semitones', () => {
    for (const type of CHORD_TYPES) {
      expect(type.intervals[0]).toEqual({ semitones: 0, degree: 1 })
      expect(type.intervals.length).toBeGreaterThanOrEqual(3)
      for (let i = 1; i < type.intervals.length; i++) {
        expect(type.intervals[i]!.semitones).toBeGreaterThan(
          type.intervals[i - 1]!.semitones,
        )
      }
    }
  })

  it('has the expected intervals for spot-checked types', () => {
    const semis = (id: Parameters<typeof getChordType>[0]) =>
      getChordType(id).intervals.map((i) => i.semitones)
    expect(semis('maj')).toEqual([0, 4, 7])
    expect(semis('maj7')).toEqual([0, 4, 7, 11])
    expect(semis('dom7')).toEqual([0, 4, 7, 10])
    expect(semis('dim7')).toEqual([0, 3, 6, 9])
    expect(semis('m7b5')).toEqual([0, 3, 6, 10])
    expect(semis('add9')).toEqual([0, 4, 7, 14])
    expect(semis('dom13')).toEqual([0, 4, 7, 10, 14, 17, 21])
  })

  it('computes pitch classes with wrap-around', () => {
    // B maj = B D♯ F♯
    expect(chordPitchClasses({ root: 11, type: getChordType('maj') })).toEqual([
      11, 3, 6,
    ])
  })

  it('chordToneAt indexes intervals and rejects out-of-range', () => {
    const cMaj = { root: 0, type: getChordType('maj') }
    expect(chordToneAt(cMaj, 0)).toBe(0)
    expect(chordToneAt(cMaj, 1)).toBe(4)
    expect(chordToneAt(cMaj, 2)).toBe(7)
    expect(chordToneAt(cMaj, 3)).toBeUndefined()
  })
})
