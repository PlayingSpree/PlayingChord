import { describe, expect, it } from 'vitest'
import { getChordType, type Chord, type ChordTypeId } from './chordTypes'
import { ALL_PITCH_CLASSES } from './notes'
import { SCALE_TYPES, getScaleType, type ScaleTypeId } from './scaleTypes'
import {
  chordDisplayName,
  formatSpelling,
  keyDisplayName,
  keySignatureAlteration,
  keySignatureAlterations,
  scaleDisplayName,
  scaleKeySignatureTonic,
  spellScale,
  vexflowKeySpec,
  spellChord,
  spellMajorScaleDegree,
  spellMidiNote,
  spellRoot,
  spellVoicing,
  vexflowKeySignature,
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

  it('accepts a key-derived root spelling override (§3.5)', () => {
    // iii of B major: the D♯ minor chord, not E♭ minor.
    const dSharp = spellMajorScaleDegree(11, 2)
    expect(chordDisplayName(chord(3, 'min'), dSharp)).toBe('D♯ min')
  })
})

describe('major-key spelling for the diatonic preset (§3.5)', () => {
  const scaleOf = (key: number) =>
    Array.from({ length: 7 }, (_, degree) =>
      formatSpelling(spellMajorScaleDegree(key, degree)),
    )

  it('names keys with the smaller signature: D♭ over C♯', () => {
    const names = Array.from({ length: 12 }, (_, pc) => keyDisplayName(pc))
    expect(names).toEqual([
      'C major',
      'D♭ major',
      'D major',
      'E♭ major',
      'E major',
      'F major',
      'F♯ major',
      'G major',
      'A♭ major',
      'A major',
      'B♭ major',
      'B major',
    ])
  })

  it('B major uses sharps the default root policy would flat', () => {
    expect(scaleOf(11)).toEqual(['B', 'C♯', 'D♯', 'E', 'F♯', 'G♯', 'A♯'])
  })

  it('D♭ major uses flats, including G♭ over the default F♯', () => {
    expect(scaleOf(1)).toEqual(['D♭', 'E♭', 'F', 'G♭', 'A♭', 'B♭', 'C'])
  })

  it('F♯ major spells its leading tone E♯', () => {
    expect(scaleOf(6)).toEqual(['F♯', 'G♯', 'A♯', 'B', 'C♯', 'D♯', 'E♯'])
  })

  it('C major is all naturals', () => {
    expect(scaleOf(0)).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B'])
  })

  it('rejects out-of-range degree indexes', () => {
    expect(() => spellMajorScaleDegree(0, 7)).toThrow()
    expect(() => spellMajorScaleDegree(0, -1)).toThrow()
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

describe('keySignatureAlteration (§3.5 staff key signature option)', () => {
  it('C major alters nothing', () => {
    for (const letter of ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const) {
      expect(keySignatureAlteration(0, letter)).toBe(0)
    }
  })

  it('G major sharps F only', () => {
    expect(keySignatureAlteration(7, 'F')).toBe(1)
    expect(keySignatureAlteration(7, 'C')).toBe(0)
  })

  it('D♭ major flats every letter but C', () => {
    expect(keySignatureAlteration(1, 'D')).toBe(-1)
    expect(keySignatureAlteration(1, 'G')).toBe(-1)
    expect(keySignatureAlteration(1, 'C')).toBe(0)
  })
})

describe('vexflowKeySignature', () => {
  it('matches the smaller-signature key names', () => {
    expect(vexflowKeySignature(0)).toBe('C')
    expect(vexflowKeySignature(7)).toBe('G')
    expect(vexflowKeySignature(1)).toBe('Db')
    expect(vexflowKeySignature(6)).toBe('F#')
  })
})

describe('scale spelling (§3.6)', () => {
  const spellScaleAs = (root: number, id: ScaleTypeId) =>
    spellScale({ root, type: getScaleType(id) }).map(formatSpelling)
  const nameOf = (root: number, id: ScaleTypeId) =>
    scaleDisplayName({ root, type: getScaleType(id) })

  it('uses every letter exactly once in all 48 scales', () => {
    for (const type of SCALE_TYPES) {
      for (const root of ALL_PITCH_CLASSES) {
        const letters = spellScale({ root, type }).map((n) => n.letter)
        expect(new Set(letters).size, `${type.id} root=${root}`).toBe(7)
      }
    }
  })

  it('names major scales by the major-key rule', () => {
    const names = ALL_PITCH_CLASSES.map((pc) => nameOf(pc, 'major'))
    expect(names).toEqual(ALL_PITCH_CLASSES.map((pc) => keyDisplayName(pc)))
  })

  it('names minor scales by the fewest-accidental minor key', () => {
    const tonics = ALL_PITCH_CLASSES.map(
      (pc) => nameOf(pc, 'natural-minor').split(' ')[0],
    )
    expect(tonics).toEqual([
      'C',
      'C♯',
      'D',
      'E♭',
      'E',
      'F',
      'F♯',
      'G',
      'G♯',
      'A',
      'B♭',
      'B',
    ])
    expect(nameOf(8, 'harmonic-minor')).toBe('G♯ harmonic minor')
  })

  it('spells G♯ harmonic minor with F𝄪', () => {
    expect(spellScaleAs(8, 'harmonic-minor')).toEqual([
      'G♯',
      'A♯',
      'B',
      'C♯',
      'D♯',
      'E',
      'F♯♯',
    ])
  })

  it('spells E♭ natural minor with C♭', () => {
    expect(spellScaleAs(3, 'natural-minor')).toEqual([
      'E♭',
      'F',
      'G♭',
      'A♭',
      'B♭',
      'C♭',
      'D♭',
    ])
  })

  it('raises melodic minor’s 6th and 7th', () => {
    expect(spellScaleAs(9, 'melodic-minor')).toEqual([
      'A',
      'B',
      'C',
      'D',
      'E',
      'F♯',
      'G♯',
    ])
  })
})

describe('scale key signatures (§3.6)', () => {
  const tonicOf = (root: number, id: ScaleTypeId) =>
    formatSpelling(scaleKeySignatureTonic({ root, type: getScaleType(id) }))

  it('is the major scale’s own key', () => {
    expect(tonicOf(1, 'major')).toBe('D♭')
  })

  it('is the relative major’s key for every minor form', () => {
    expect(tonicOf(9, 'natural-minor')).toBe('C')
    expect(tonicOf(8, 'harmonic-minor')).toBe('B')
    expect(tonicOf(1, 'melodic-minor')).toBe('E')
    // G♭, not the major-key policy's F♯ — the signature must agree with
    // the flats E♭ minor is spelled in.
    expect(tonicOf(3, 'natural-minor')).toBe('G♭')
  })

  it('computes alterations and VexFlow keys from a spelled tonic', () => {
    const gFlat = scaleKeySignatureTonic({
      root: 3,
      type: getScaleType('natural-minor'),
    })
    expect(vexflowKeySpec(gFlat)).toBe('Gb')
    const alterations = keySignatureAlterations(gFlat)
    expect(alterations.get('C')).toBe(-1)
    expect(alterations.get('F')).toBe(0)
  })
})
