import { describe, expect, it } from 'vitest'
import {
  getChordType,
  type Chord,
  type ChordType,
  type ChordTypeId,
} from './chordTypes'
import { grandStaffLayout } from './staff'

const chord = (root: number, typeId: ChordTypeId): Chord => ({
  root,
  type: getChordType(typeId),
})

const keys = (notes: { key: string }[]) => notes.map((n) => n.key)

// Awkward roots must come out spelled right on the staff, not just in text
// (F♯ maj7's seventh is E♯, never F).
describe('grandStaffLayout', () => {
  it('spells F♯ maj7 with sharps up to E♯', () => {
    const layout = grandStaffLayout(chord(6, 'maj7'), [66, 70, 73, 77])
    expect(keys(layout.treble)).toEqual(['f#/4', 'a#/4', 'c#/5', 'e#/5'])
    expect(layout.treble.map((n) => n.accidental)).toEqual(['#', '#', '#', '#'])
    expect(layout.bass).toEqual([])
  })

  it('spells A♭ min with C♭, octave following the letter', () => {
    const layout = grandStaffLayout(chord(8, 'min'), [68, 71, 75])
    // C♭5 sounds as B4 (MIDI 71) — the key's octave follows the letter.
    expect(keys(layout.treble)).toEqual(['ab/4', 'cb/5', 'eb/5'])
    expect(layout.treble.map((n) => n.accidental)).toEqual(['b', 'b', 'b'])
  })

  it('splits B dom9 across both staves at middle C', () => {
    const layout = grandStaffLayout(chord(11, 'dom9'), [59, 63, 66, 69, 73])
    expect(keys(layout.bass)).toEqual(['b/3'])
    expect(keys(layout.treble)).toEqual(['d#/4', 'f#/4', 'a/4', 'c#/5'])
    expect(layout.treble.map((n) => n.accidental)).toEqual([
      '#',
      '#',
      null,
      '#',
    ])
  })

  it('renders A♭ dim7 double flats', () => {
    const layout = grandStaffLayout(chord(8, 'dim7'), [68, 71, 74, 77])
    expect(keys(layout.treble)).toEqual(['ab/4', 'cb/5', 'ebb/5', 'gbb/5'])
    expect(layout.treble.map((n) => n.accidental)).toEqual([
      'b',
      'b',
      'bb',
      'bb',
    ])
  })

  it('puts middle C itself on the treble stave', () => {
    const c4 = grandStaffLayout(chord(0, 'maj'), [60, 64, 67])
    expect(keys(c4.treble)).toEqual(['c/4', 'e/4', 'g/4'])
    expect(c4.bass).toEqual([])

    const c3 = grandStaffLayout(chord(0, 'maj'), [48, 52, 55])
    expect(keys(c3.bass)).toEqual(['c/3', 'e/3', 'g/3'])
    expect(c3.treble).toEqual([])
  })

  it('keeps naturals free of accidental glyphs', () => {
    const layout = grandStaffLayout(chord(0, 'maj7'), [60, 64, 67, 71])
    expect(layout.treble.every((n) => n.accidental === null)).toBe(true)
  })

  it('respells beyond-double accidentals from the default root policy', () => {
    // No built-in type produces one; force a triple sharp via a synthetic
    // interval — B♭'s "7th" two semitones up spells as A♯♯♯ (pc 0).
    const weird: ChordType = {
      ...getChordType('maj'),
      intervals: [
        { semitones: 0, degree: 1 },
        { semitones: 2, degree: 7 },
      ],
    }
    const layout = grandStaffLayout({ root: 10, type: weird }, [60])
    expect(keys(layout.treble)).toEqual(['c/4'])
    expect(layout.treble[0]?.accidental).toBeNull()
  })
})
