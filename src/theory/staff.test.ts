import { describe, expect, it } from 'vitest'
import {
  getChordType,
  type Chord,
  type ChordType,
  type ChordTypeId,
} from './chordTypes'
import { getScaleType, type ScaleTypeId } from './scaleTypes'
import { grandStaffLayout, scaleStaffLine } from './staff'

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

  it('drops the accidental glyph when the key signature already covers it', () => {
    // G major (key=7) sharps F; the maj7's F# tone needs no glyph.
    const layout = grandStaffLayout(chord(7, 'maj7'), [67, 71, 74, 78], 7)
    expect(keys(layout.treble)).toEqual(['g/4', 'b/4', 'd/5', 'f#/5'])
    expect(layout.treble.map((n) => n.accidental)).toEqual([
      null,
      null,
      null,
      null,
    ])
  })

  it('adds a courtesy natural when the key signature alters a letter this note leaves plain', () => {
    // G major sharps F; a plain F (dom7's b7) needs an explicit natural.
    const layout = grandStaffLayout(chord(7, 'dom7'), [67, 71, 74, 77], 7)
    expect(keys(layout.treble)).toEqual(['g/4', 'b/4', 'd/5', 'f/5'])
    expect(layout.treble.map((n) => n.accidental)).toEqual([
      null,
      null,
      null,
      'n',
    ])
  })

  it('keeps a note not covered by the key signature spelled as usual', () => {
    // C major (key=0) alters nothing; C# still needs its sharp glyph.
    const layout = grandStaffLayout(chord(0, 'aug'), [60, 64, 68], 0)
    expect(keys(layout.treble)).toEqual(['c/4', 'e/4', 'g#/4'])
    expect(layout.treble.map((n) => n.accidental)).toEqual([null, null, '#'])
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

describe('scaleStaffLine (§3.6)', () => {
  const line = (root: number, id: ScaleTypeId, withKey: boolean) =>
    scaleStaffLine({ root, type: getScaleType(id) }, withKey)

  it('draws the one-octave ascending line from the tonic near middle C', () => {
    const c = line(0, 'major', false)
    expect(keys(c.notes)).toEqual([
      'c/4',
      'd/4',
      'e/4',
      'f/4',
      'g/4',
      'a/4',
      'b/4',
      'c/5',
    ])
    expect(c.keySignature).toBeNull()
  })

  it('writes G♯ harmonic minor’s F𝄪 as a double sharp', () => {
    const gSharp = line(8, 'harmonic-minor', false)
    expect(gSharp.notes[6]).toEqual({ key: 'f##/5', accidental: '##' })
  })

  it('draws a minor scale under its relative major, raised degrees marked', () => {
    const a = line(9, 'harmonic-minor', true)
    expect(a.keySignature).toBe('C')
    expect(a.notes.map((n) => n.accidental)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
      '#',
      null,
    ])
    const eFlat = line(3, 'natural-minor', true)
    expect(eFlat.keySignature).toBe('Gb')
    expect(eFlat.notes.every((n) => n.accidental === null)).toBe(true)
    // C♭ follows its letter into octave 5, though it sounds as B4.
    expect(keys(eFlat.notes)[5]).toBe('cb/5')
  })
})
