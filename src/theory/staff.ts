import { MIDDLE_C, pitchClass, type PitchClass } from './notes'
import type { Chord } from './chordTypes'
import type { Scale } from './scaleTypes'
import { getScaleShape } from './scaleShapes'
import { realizeScale } from './realize'
import {
  keySignatureAlterations,
  scaleKeySignatureTonic,
  spellMajorKeyTonic,
  spellMidiNote,
  spellRoot,
  spellScale,
  spellVoicing,
  vexflowKeySpec,
  type Letter,
  type SpelledNote,
} from './spelling'

// Grand-staff layout for a concrete voicing (DESIGN.md §3.4/§3.5): the pure
// half of the Phase 8 staff. The VexFlow component consumes this without any
// spelling math of its own, so the "third of B major is D♯" class of logic
// stays unit-testable here.

export type Clef = 'treble' | 'bass'

// One note ready for VexFlow: `key` is its letter+accidental/octave spec
// ("e#/5" — the octave follows the letter, so C♭5 sounds as B4), and
// `accidental` is the glyph to attach (null = natural, no glyph drawn;
// 'n' = courtesy natural, only reachable when a key signature is active
// and this letter's signature accidental doesn't apply to this note).
export interface StaffNote {
  key: string
  accidental: '#' | '##' | 'b' | 'bb' | 'n' | null
}

export interface GrandStaffLayout {
  treble: StaffNote[]
  bass: StaffNote[]
}

// VexFlow renders up to double accidentals; anything wilder (reachable only
// through pathological custom chord data) is respelled from the default root
// policy, which never exceeds a single accidental.
function renderable(note: SpelledNote): SpelledNote {
  if (Math.abs(note.accidental) <= 2) return note
  return spellMidiNote(note.midi, spellRoot(pitchClass(note.midi)))
}

// `signature`, when given, is the letter → accidental map of the key
// signature drawn on the stave (§3.5 option): a note's glyph is then only
// what's *not* already implied by that signature — dropped entirely when it
// matches, a courtesy natural when the note is plain but the signature
// alters its letter, otherwise the note's own sharps/flats as usual.
function toStaffNote(
  spelled: SpelledNote,
  signature?: ReadonlyMap<Letter, number>,
): StaffNote {
  const note = renderable(spelled)
  const marks =
    note.accidental > 0
      ? '#'.repeat(note.accidental)
      : note.accidental < 0
        ? 'b'.repeat(-note.accidental)
        : ''
  const noteKey = `${note.letter.toLowerCase()}${marks}/${note.octave}`
  if (signature === undefined) {
    return {
      key: noteKey,
      accidental: marks === '' ? null : (marks as StaffNote['accidental']),
    }
  }
  const keyAlteration = signature.get(note.letter) ?? 0
  if (note.accidental === keyAlteration) {
    return { key: noteKey, accidental: null }
  }
  if (note.accidental === 0) {
    return { key: noteKey, accidental: 'n' }
  }
  return { key: noteKey, accidental: marks as StaffNote['accidental'] }
}

// Notes below middle C sit on the bass stave, middle C and above on the
// treble — the natural reading for examples realized near middle C (§3.4).
export function grandStaffLayout(
  chord: Chord,
  notes: readonly number[],
  key?: PitchClass,
): GrandStaffLayout {
  const layout: GrandStaffLayout = { treble: [], bass: [] }
  const signature =
    key === undefined
      ? undefined
      : keySignatureAlterations(spellMajorKeyTonic(key))
  for (const spelled of spellVoicing(chord, notes)) {
    const clef = spelled.midi < MIDDLE_C ? layout.bass : layout.treble
    clef.push(toStaffNote(spelled, signature))
  }
  return layout
}

// A scale prompt's staff (§3.6, §7.3): whatever the shape, the one-octave
// ascending line in the treble clef near middle C, spelled by degree. With
// the key-signature setting on, `keySignature` is the VexFlow key to draw —
// the relative major's for a minor scale — and the raised degrees of
// harmonic/melodic minor keep their accidentals.
export interface ScaleStaffLine {
  notes: StaffNote[]
  keySignature: string | null
}

export function scaleStaffLine(
  scale: Scale,
  withKeySignature: boolean,
): ScaleStaffLine {
  const spellings = spellScale(scale)
  const signatureTonic = scaleKeySignatureTonic(scale)
  const signature = withKeySignature
    ? keySignatureAlterations(signatureTonic)
    : undefined
  const notes = realizeScale(scale, getScaleShape('up-1')).map((midi, i) => {
    const spelling = spellings[i % spellings.length]
    if (!spelling) throw new Error(`No spelling for scale note ${i}`)
    return toStaffNote(spellMidiNote(midi, spelling), signature)
  })
  return {
    notes,
    keySignature: withKeySignature ? vexflowKeySpec(signatureTonic) : null,
  }
}
