import { pitchClass, type PitchClass } from './notes'

// A chord tone: semitone offset from the root plus the scale degree it spells
// as (DESIGN.md §3.5 — the ♯5 of aug must spell as ♯5, never ♭6).
export interface ChordInterval {
  semitones: number
  degree: number // 1 = root, 3 = third, 7 = seventh, 9/11/13 = extensions
}

// Chord types are data (DESIGN.md §3.2): id, display name,
// [semitones from root, scale degree] per chord tone.
const TABLE = [
  [
    'maj',
    'Major',
    [
      [0, 1],
      [4, 3],
      [7, 5],
    ],
  ],
  [
    'min',
    'Minor',
    [
      [0, 1],
      [3, 3],
      [7, 5],
    ],
  ],
  [
    'dim',
    'Diminished',
    [
      [0, 1],
      [3, 3],
      [6, 5],
    ],
  ],
  [
    'aug',
    'Augmented',
    [
      [0, 1],
      [4, 3],
      [8, 5],
    ],
  ],
  [
    'sus2',
    'Sus2',
    [
      [0, 1],
      [2, 2],
      [7, 5],
    ],
  ],
  [
    'sus4',
    'Sus4',
    [
      [0, 1],
      [5, 4],
      [7, 5],
    ],
  ],
  [
    'maj6',
    'Major 6th',
    [
      [0, 1],
      [4, 3],
      [7, 5],
      [9, 6],
    ],
  ],
  [
    'min6',
    'Minor 6th',
    [
      [0, 1],
      [3, 3],
      [7, 5],
      [9, 6],
    ],
  ],
  [
    'add9',
    'Add 9',
    [
      [0, 1],
      [4, 3],
      [7, 5],
      [14, 9],
    ],
  ],
  [
    'maj7',
    'Major 7th',
    [
      [0, 1],
      [4, 3],
      [7, 5],
      [11, 7],
    ],
  ],
  [
    'min7',
    'Minor 7th',
    [
      [0, 1],
      [3, 3],
      [7, 5],
      [10, 7],
    ],
  ],
  [
    'dom7',
    'Dominant 7th',
    [
      [0, 1],
      [4, 3],
      [7, 5],
      [10, 7],
    ],
  ],
  [
    'dim7',
    'Diminished 7th',
    [
      [0, 1],
      [3, 3],
      [6, 5],
      [9, 7],
    ],
  ],
  [
    'm7b5',
    'Half-Diminished 7th',
    [
      [0, 1],
      [3, 3],
      [6, 5],
      [10, 7],
    ],
  ],
  [
    'maj9',
    'Major 9th',
    [
      [0, 1],
      [4, 3],
      [7, 5],
      [11, 7],
      [14, 9],
    ],
  ],
  [
    'min9',
    'Minor 9th',
    [
      [0, 1],
      [3, 3],
      [7, 5],
      [10, 7],
      [14, 9],
    ],
  ],
  [
    'dom9',
    'Dominant 9th',
    [
      [0, 1],
      [4, 3],
      [7, 5],
      [10, 7],
      [14, 9],
    ],
  ],
  [
    'dom11',
    'Dominant 11th',
    [
      [0, 1],
      [4, 3],
      [7, 5],
      [10, 7],
      [14, 9],
      [17, 11],
    ],
  ],
  [
    'dom13',
    'Dominant 13th',
    [
      [0, 1],
      [4, 3],
      [7, 5],
      [10, 7],
      [14, 9],
      [17, 11],
      [21, 13],
    ],
  ],
] as const

export type ChordTypeId = (typeof TABLE)[number][0]

export interface ChordType {
  id: ChordTypeId
  name: string
  intervals: readonly ChordInterval[]
}

export const CHORD_TYPES: readonly ChordType[] = TABLE.map(
  ([id, name, intervals]) => ({
    id,
    name,
    intervals: intervals.map(([semitones, degree]) => ({ semitones, degree })),
  }),
)

const BY_ID = new Map(CHORD_TYPES.map((type) => [type.id, type]))

export function getChordType(id: ChordTypeId): ChordType {
  const type = BY_ID.get(id)
  if (!type) throw new Error(`Unknown chord type: ${id}`)
  return type
}

export interface Chord {
  root: PitchClass
  type: ChordType
}

export function chordPitchClasses(chord: Chord): PitchClass[] {
  return chord.type.intervals.map((i) => pitchClass(chord.root + i.semitones))
}

// The chord tone at an interval index (0 = root, 1 = the tone a 1st-inversion
// bass constraint targets, ...); undefined when the index is out of range for
// this chord type — that combination is unsatisfiable (DESIGN.md §4).
export function chordToneAt(
  chord: Chord,
  index: number,
): PitchClass | undefined {
  const interval = chord.type.intervals[index]
  return interval === undefined
    ? undefined
    : pitchClass(chord.root + interval.semitones)
}
