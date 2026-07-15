import { describe, expect, it } from 'vitest'
import { getChordType, type Chord, type ChordTypeId } from './chordTypes'
import {
  chordDisplayName,
  formatSpelling,
  spellChord,
  spellMidiNote,
  spellRoot,
  spellVoicing,
} from './spelling'

const chord = (root: number, id: ChordTypeId): Chord => ({
  root,
  type: getChordType(id),
})

const spellChordAs = (root: number, id: ChordTypeId) =>
  spellChord(chord(root, id)).map(formatSpelling)

describe('root spelling policy (§3.5)', () => {
  it('spells all 12 pitch classes with conventional mixed sharps/flats', () => {
    const names = Array.from({ length: 12 }, (_, pc) =>
      formatSpelling(spellRoot(pc)),
    )
    expect(names).toEqual([
      'C',
      'C♯',
      'D',
      'E♭',
      'E',
      'F',
      'F♯',
      'G',
      'A♭',
      'A',
      'B♭',
      'B',
    ])
  })
})

describe('chord-tone spelling from degrees (§3.5)', () => {
  it('the third of B major is D♯, not E♭', () => {
    expect(spellChordAs(11, 'maj')).toEqual(['B', 'D♯', 'F♯'])
  })

  it('the ♯5 of C aug is G♯, not A♭', () => {
    expect(spellChordAs(0, 'aug')).toEqual(['C', 'E', 'G♯'])
  })

  it('F♯ maj7 spells its seventh as E♯', () => {
    expect(spellChordAs(6, 'maj7')).toEqual(['F♯', 'A♯', 'C♯', 'E♯'])
  })

  it('E♭ min uses flats throughout', () => {
    expect(spellChordAs(3, 'min')).toEqual(['E♭', 'G♭', 'B♭'])
  })

  it('A♭ dim7 needs double flats', () => {
    expect(spellChordAs(8, 'dim7')).toEqual(['A♭', 'C♭', 'E♭♭', 'G♭♭'])
  })

  it('extensions wrap the letter cycle: the 9th of C add9 is D', () => {
    expect(spellChordAs(0, 'add9')).toEqual(['C', 'E', 'G', 'D'])
  })

  it('C dom13 spells every extension diatonically', () => {
    expect(spellChordAs(0, 'dom13')).toEqual([
      'C',
      'E',
      'G',
      'B♭',
      'D',
      'F',
      'A',
    ])
  })
})

describe('chordDisplayName (§3.4)', () => {
  it('is root + type id only', () => {
    expect(chordDisplayName(chord(0, 'maj7'))).toBe('C maj7')
    expect(chordDisplayName(chord(3, 'min'))).toBe('E♭ min')
  })
})

describe('spellMidiNote — octave follows the letter', () => {
  const spelling = (letter: 'C' | 'B', accidental: number, pc: number) => ({
    letter,
    accidental,
    pc,
  })

  it('C4 = MIDI 60', () => {
    expect(spellMidiNote(60, spelling('C', 0, 0)).octave).toBe(4)
  })

  it('C♭4 sounds as MIDI 59', () => {
    expect(spellMidiNote(59, spelling('C', -1, 11)).octave).toBe(4)
  })

  it('B♯3 sounds as MIDI 60', () => {
    expect(spellMidiNote(60, spelling('B', 1, 0)).octave).toBe(3)
  })
})

describe('spellVoicing', () => {
  it('spells a C maj7 voicing as C4 E4 G4 B4', () => {
    const spelled = spellVoicing(chord(0, 'maj7'), [60, 64, 67, 71])
    expect(spelled.map((n) => `${formatSpelling(n)}${n.octave}`)).toEqual([
      'C4',
      'E4',
      'G4',
      'B4',
    ])
  })

  it('uses chord spellings for doubled tones across octaves', () => {
    const spelled = spellVoicing(chord(11, 'maj'), [47, 51, 54, 59])
    expect(spelled.map((n) => `${formatSpelling(n)}${n.octave}`)).toEqual([
      'B2',
      'D♯3',
      'F♯3',
      'B3',
    ])
  })

  it('falls back to the root policy for non-chord notes', () => {
    const spelled = spellVoicing(chord(0, 'maj'), [60, 61])
    expect(spelled.map(formatSpelling)).toEqual(['C', 'C♯'])
  })
})
