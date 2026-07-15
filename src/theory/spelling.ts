import { pitchClass, type PitchClass } from './notes'
import { chordPitchClasses, type Chord, type ChordInterval } from './chordTypes'

// Notation spelling (DESIGN.md §3.5): pitch classes alone can't drive the
// staff — the third of B major is D♯, not E♭. Letters and accidentals are
// derived from the root's letter plus each interval's scale degree.

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const
const LETTER_PCS: readonly PitchClass[] = [0, 2, 4, 5, 7, 9, 11]

export type Letter = (typeof LETTERS)[number]

export interface NoteSpelling {
  letter: Letter
  accidental: number // semitones from the natural letter: -1 = ♭, +1 = ♯
  pc: PitchClass
}

// Default root policy: C C♯ D E♭ E F F♯ G A♭ A B♭ B (conventional mixed
// sharps/flats). Key-aware root spelling for the diatonic preset comes with
// the preset work, not here.
const ROOT_POLICY: readonly (readonly [Letter, number])[] = [
  ['C', 0],
  ['C', 1],
  ['D', 0],
  ['E', -1],
  ['E', 0],
  ['F', 0],
  ['F', 1],
  ['G', 0],
  ['A', -1],
  ['A', 0],
  ['B', -1],
  ['B', 0],
]

export function spellRoot(pc: PitchClass): NoteSpelling {
  const entry = ROOT_POLICY[pitchClass(pc)]
  if (!entry) throw new Error(`Invalid pitch class: ${pc}`)
  const [letter, accidental] = entry
  return { letter, accidental, pc: pitchClass(pc) }
}

// Smallest signed semitone distance from a letter's natural pitch class to
// the target — keeps accidentals minimal (D♯, not E♭♭♭...).
function signedPcDelta(delta: number): number {
  return (((((delta % 12) + 12) % 12) + 6) % 12) - 6
}

export function spellChordTone(
  root: NoteSpelling,
  interval: ChordInterval,
): NoteSpelling {
  const rootLetterIndex = LETTERS.indexOf(root.letter)
  const letterIndex = (rootLetterIndex + interval.degree - 1) % 7
  const letter = LETTERS[letterIndex]
  const naturalPc = LETTER_PCS[letterIndex]
  if (letter === undefined || naturalPc === undefined) {
    throw new Error(`Invalid interval degree: ${interval.degree}`)
  }
  const pc = pitchClass(root.pc + interval.semitones)
  return { letter, accidental: signedPcDelta(pc - naturalPc), pc }
}

// One spelling per chord tone, in interval order (root first).
export function spellChord(chord: Chord): NoteSpelling[] {
  const root = spellRoot(chord.root)
  return chord.type.intervals.map((interval) => spellChordTone(root, interval))
}

export function formatSpelling(spelling: NoteSpelling): string {
  const { letter, accidental } = spelling
  const mark = accidental > 0 ? '♯'.repeat(accidental) : '♭'.repeat(-accidental)
  return `${letter}${mark}`
}

// Prompt display name (DESIGN.md §3.4): root + type id only — the voicing
// being drilled is shown separately, never folded into a slash-chord name.
export function chordDisplayName(chord: Chord): string {
  return `${formatSpelling(spellRoot(chord.root))} ${chord.type.id}`
}

// A concrete note on the staff. The octave follows the *letter*, not the
// sounding pitch: C♭4 is MIDI 59, B♯3 is MIDI 60.
export interface SpelledNote extends NoteSpelling {
  midi: number
  octave: number
}

export function spellMidiNote(
  midi: number,
  spelling: NoteSpelling,
): SpelledNote {
  return {
    ...spelling,
    midi,
    octave: Math.floor((midi - spelling.accidental) / 12) - 1,
  }
}

// Spells a voicing's notes using the chord's tone spellings; notes outside
// the chord (possible with strict extra notes off) fall back to the default
// root policy.
export function spellVoicing(
  chord: Chord,
  notes: readonly number[],
): SpelledNote[] {
  const byPc = new Map<PitchClass, NoteSpelling>()
  const spellings = spellChord(chord)
  chordPitchClasses(chord).forEach((pc, i) => {
    const spelling = spellings[i]
    if (spelling && !byPc.has(pc)) byPc.set(pc, spelling)
  })
  return notes.map((midi) => {
    const pc = pitchClass(midi)
    return spellMidiNote(midi, byPc.get(pc) ?? spellRoot(pc))
  })
}
