import { MIDDLE_C, pitchClass } from './notes'
import type { Chord } from './chordTypes'
import {
  spellMidiNote,
  spellRoot,
  spellVoicing,
  type SpelledNote,
} from './spelling'

// Grand-staff layout for a concrete voicing (DESIGN.md §3.4/§3.5): the pure
// half of the Phase 8 staff. The VexFlow component consumes this without any
// spelling math of its own, so the "third of B major is D♯" class of logic
// stays unit-testable here.

export type Clef = 'treble' | 'bass'

// One note ready for VexFlow: `key` is its letter+accidental/octave spec
// ("e#/5" — the octave follows the letter, so C♭5 sounds as B4), and
// `accidental` is the glyph to attach (null = natural, no glyph drawn).
export interface StaffNote {
  key: string
  accidental: '#' | '##' | 'b' | 'bb' | null
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

function toStaffNote(spelled: SpelledNote): StaffNote {
  const note = renderable(spelled)
  const marks =
    note.accidental > 0
      ? '#'.repeat(note.accidental)
      : 'b'.repeat(-note.accidental)
  return {
    key: `${note.letter.toLowerCase()}${marks}/${note.octave}`,
    accidental: marks === '' ? null : (marks as StaffNote['accidental']),
  }
}

// Notes below middle C sit on the bass stave, middle C and above on the
// treble — the natural reading for examples realized near middle C (§3.4).
export function grandStaffLayout(
  chord: Chord,
  notes: readonly number[],
): GrandStaffLayout {
  const layout: GrandStaffLayout = { treble: [], bass: [] }
  for (const spelled of spellVoicing(chord, notes)) {
    const clef = spelled.midi < MIDDLE_C ? layout.bass : layout.treble
    clef.push(toStaffNote(spelled))
  }
  return layout
}
