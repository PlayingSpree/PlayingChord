import { pitchClass, type PitchClass } from './notes'
import type { ChordInterval } from './chordTypes'

// Scale types are data, beside the chord types (DESIGN.md §3.6): id, display
// name, tonality (which key-naming rule spells the tonic, §3.6 Spelling),
// intervals with their degrees (as chord intervals carry, §3.2) and the
// fingering per root.
//
// Fingering is shown, never judged. Each row is the standard ABRSM fingering
// (Piano Scales & Arpeggios, 2021 syllabus) for one octave ascending from
// the tonic, [right hand, left hand], indexed by root pitch class. Longer
// runs follow the usual crossing pattern — see scaleFingering below. Minor
// forms that finger differently from the natural minor have their own rows
// rather than overrides, so each table can be read against the book as is.
type FingeringRow = readonly [rh: string, lh: string]

const MAJOR_FINGERING: readonly FingeringRow[] = [
  ['12312345', '54321321'], // C
  ['23123412', '32143213'], // D♭
  ['12312345', '54321321'], // D
  ['31234123', '32143213'], // E♭
  ['12312345', '54321321'], // E
  ['12341234', '54321321'], // F
  ['23412312', '43213214'], // F♯
  ['12312345', '54321321'], // G
  ['34123123', '32143213'], // A♭
  ['12312345', '54321321'], // A
  ['41231234', '32143213'], // B♭
  ['12312345', '43214321'], // B
]

const NATURAL_MINOR_FINGERING: readonly FingeringRow[] = [
  ['12312345', '54321321'], // C
  ['34123123', '32143213'], // C♯
  ['12312345', '54321321'], // D
  ['31234123', '21432132'], // E♭
  ['12312345', '54321321'], // E
  ['12341234', '54321321'], // F
  ['34123123', '43213214'], // F♯
  ['12312345', '54321321'], // G
  ['34123123', '32132143'], // G♯ — F♯ is black, so the LH thumb takes E
  ['12312345', '54321321'], // A
  ['21231234', '21321432'], // B♭
  ['12312345', '43214321'], // B
]

const HARMONIC_MINOR_FINGERING: readonly FingeringRow[] = [
  ['12312345', '54321321'], // C
  ['34123123', '32143213'], // C♯
  ['12312345', '54321321'], // D
  ['31234123', '21432132'], // E♭
  ['12312345', '54321321'], // E
  ['12341234', '54321321'], // F
  ['34123123', '43213214'], // F♯
  ['12312345', '54321321'], // G
  ['34123123', '32143213'], // G♯ — F𝄪 is white, the LH thumb takes it
  ['12312345', '54321321'], // A
  ['21231234', '21321432'], // B♭
  ['12312345', '43214321'], // B
]

const MELODIC_MINOR_FINGERING: readonly FingeringRow[] = [
  ['12312345', '54321321'], // C
  ['23123412', '32143213'], // C♯ — raised A♯ is black, RH thumb takes B♯
  ['12312345', '54321321'], // D
  ['31234123', '21432132'], // E♭
  ['12312345', '54321321'], // E
  ['12341234', '54321321'], // F
  ['23123412', '43213214'], // F♯ — raised D♯ is black, RH thumb takes E♯
  ['12312345', '54321321'], // G
  ['34123123', '32143213'], // G♯
  ['12312345', '54321321'], // A
  ['21231234', '21321432'], // B♭
  ['12312345', '43214321'], // B
]

// [semitones from root, scale degree] per note, as in chordTypes.ts.
const TABLE = [
  [
    'major',
    'major',
    'major',
    [
      [0, 1],
      [2, 2],
      [4, 3],
      [5, 4],
      [7, 5],
      [9, 6],
      [11, 7],
    ],
    MAJOR_FINGERING,
  ],
  [
    'natural-minor',
    'natural minor',
    'minor',
    [
      [0, 1],
      [2, 2],
      [3, 3],
      [5, 4],
      [7, 5],
      [8, 6],
      [10, 7],
    ],
    NATURAL_MINOR_FINGERING,
  ],
  [
    'harmonic-minor',
    'harmonic minor',
    'minor',
    [
      [0, 1],
      [2, 2],
      [3, 3],
      [5, 4],
      [7, 5],
      [8, 6],
      [11, 7],
    ],
    HARMONIC_MINOR_FINGERING,
  ],
  // Ascending form only: the descending form is the natural minor, and a
  // scale that changes on the way down is a technique drill (§3.6).
  [
    'melodic-minor',
    'melodic minor',
    'minor',
    [
      [0, 1],
      [2, 2],
      [3, 3],
      [5, 4],
      [7, 5],
      [9, 6],
      [11, 7],
    ],
    MELODIC_MINOR_FINGERING,
  ],
] as const

export type ScaleTypeId = (typeof TABLE)[number][0]

export type Hand = 'rh' | 'lh'

export interface ScaleFingering {
  rh: readonly number[] // one octave ascending, tonic to tonic
  lh: readonly number[]
}

export interface ScaleType {
  id: ScaleTypeId
  name: string
  tonality: 'major' | 'minor'
  intervals: readonly ChordInterval[]
  fingering: readonly ScaleFingering[] // indexed by root pitch class
}

const digits = (fingers: string): number[] => [...fingers].map(Number)

export const SCALE_TYPES: readonly ScaleType[] = TABLE.map(
  ([id, name, tonality, intervals, fingering]) => ({
    id,
    name,
    tonality,
    intervals: intervals.map(([semitones, degree]) => ({ semitones, degree })),
    fingering: fingering.map(([rh, lh]) => ({
      rh: digits(rh),
      lh: digits(lh),
    })),
  }),
)

const BY_ID = new Map(SCALE_TYPES.map((type) => [type.id, type]))

export function getScaleType(id: ScaleTypeId): ScaleType {
  const type = BY_ID.get(id)
  if (!type) throw new Error(`Unknown scale type: ${id}`)
  return type
}

export function isScaleTypeId(id: string): id is ScaleTypeId {
  return BY_ID.has(id as ScaleTypeId)
}

// A scale is a root plus a type, exactly as a chord is (§3.6).
export interface Scale {
  root: PitchClass
  type: ScaleType
}

export function scalePitchClasses(scale: Scale): PitchClass[] {
  return scale.type.intervals.map((i) => pitchClass(scale.root + i.semitones))
}

// The ascending fingering for an `octaves`-long run, one finger per note
// (octaves × 7 + 1). The book's one-octave row starts and ends where a hand
// can start and stop; a longer run instead crosses at each inner tonic,
// which takes whichever finger continues the pattern between the 7th degree
// before it and the 2nd degree after it. Ascending, the RH's fingers climb
// until the thumb passes under and the LH's fall until a finger crosses
// over the thumb, so that finger is one step on from the 7th's when the
// thumb is the tonic's neighbour on the crossing side (B♭ minor RH: A♭ 3,
// B♭ 4, C 1), else one step back from the 2nd's (C major RH: B 4, C 1, D 2).
// Descending plays the same fingers in reverse.
export function scaleFingering(
  scale: Scale,
  hand: Hand,
  octaves: number,
): number[] {
  const row = scale.type.fingering[pitchClass(scale.root)]
  if (!row) throw new Error(`No fingering for root ${scale.root}`)
  const f = row[hand]
  const first = f[0]
  const second = f[1]
  const last = f[f.length - 1]
  const seventh = f[f.length - 2]
  if (
    first === undefined ||
    second === undefined ||
    last === undefined ||
    seventh === undefined
  ) {
    return []
  }
  const inner = f.slice(1, -1)
  const innerTonic =
    hand === 'rh'
      ? second === 1
        ? seventh + 1
        : second - 1
      : seventh === 1
        ? second + 1
        : seventh - 1
  const fingers = [first, ...inner]
  for (let octave = 1; octave < octaves; octave++) {
    fingers.push(innerTonic, ...inner)
  }
  fingers.push(last)
  return fingers
}
