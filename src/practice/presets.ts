import {
  ALL_PITCH_CLASSES,
  BUILT_IN_VOICING_LIBRARY,
  getChordType,
  MAJOR_SCALE_SEMITONES,
  pitchClass,
  realizeVoicing,
  spellMajorScaleDegree,
  type ChordTypeId,
  type NoteSpelling,
  type PitchClass,
  type ScaleShapeId,
  type ScaleTypeId,
  type VoicingLibrary,
} from '../theory'
import type { ChordCombo, Combo, ScaleCombo } from './combos'

// A preset defines the pool the generator draws from (DESIGN.md §4). Pools
// have variants because some (diatonic) are root+quality *pairs*, not a
// full cross product.
export type ChordPool =
  | {
      kind: 'product'
      roots: readonly PitchClass[]
      chordTypes: readonly ChordTypeId[]
    }
  | { kind: 'explicit'; chords: readonly PoolChord[] }
  | { kind: 'diatonic'; key: PitchClass } // major key → I ii iii IV V vi vii° triads

export interface PoolChord {
  root: PitchClass
  typeId: ChordTypeId
}

// `kind` is optional on the chord side: presets stored or exported before
// scales existed carry none, and absence means 'chord' (§4).
export interface ChordPreset {
  kind?: 'chord'
  id: string
  name: string
  pool: ChordPool
  voicingIds: readonly string[] // references into the VoicingRule library (§3.3)
}

// A scale preset (§4): roots × scale types, each pool scale expanding to one
// combo per shape — shape ids stand where a chord preset's voicing ids do.
export interface ScalePool {
  kind: 'product'
  roots: readonly PitchClass[]
  scaleTypes: readonly ScaleTypeId[]
}

export interface ScalePreset {
  kind: 'scale'
  id: string
  name: string
  pool: ScalePool
  shapeIds: readonly ScaleShapeId[]
}

export type Preset = ChordPreset | ScalePreset

export function isScalePreset(preset: Preset): preset is ScalePreset {
  return preset.kind === 'scale'
}

export interface PoolScale {
  root: PitchClass
  scaleTypeId: ScaleTypeId
}

export function poolScales(pool: ScalePool): PoolScale[] {
  return pool.roots.flatMap((root) =>
    pool.scaleTypes.map((scaleTypeId) => ({ root, scaleTypeId })),
  )
}

// Triad quality of each major-scale degree: I ii iii IV V vi vii°.
// Exported for Song mode (§6.5), whose progressions are built per degree.
export const DIATONIC_QUALITIES: readonly ChordTypeId[] = [
  'maj',
  'min',
  'min',
  'maj',
  'maj',
  'min',
  'dim',
]

export function poolChords(pool: ChordPool): PoolChord[] {
  switch (pool.kind) {
    case 'product':
      return pool.roots.flatMap((root) =>
        pool.chordTypes.map((typeId) => ({ root, typeId })),
      )
    case 'explicit':
      return [...pool.chords]
    case 'diatonic':
      return DIATONIC_QUALITIES.map((typeId, degree) => {
        const semitones = MAJOR_SCALE_SEMITONES[degree] ?? 0
        return { root: pitchClass(pool.key + semitones), typeId }
      })
  }
}

export interface ExpandedPreset {
  // One combo per (chord × voicing rule), or (scale × shape) — the §5
  // generation/stats unit.
  combos: readonly Combo[]
  // Display-only: the diatonic pool spells roots from its key (§3.5). Roots
  // absent from the map use the default root policy.
  rootSpellings: ReadonlyMap<PitchClass, NoteSpelling>
}

export function expandPreset(
  preset: Preset,
  voicings: VoicingLibrary = BUILT_IN_VOICING_LIBRARY,
): ExpandedPreset {
  if (isScalePreset(preset)) {
    // Every scale plays in every shape — nothing to drop. A scale spells
    // itself from its own key (§3.6), so there's no pool spelling either.
    const combos: ScaleCombo[] = poolScales(preset.pool).flatMap(
      ({ root, scaleTypeId }) =>
        preset.shapeIds.map((shapeId) => ({
          kind: 'scale' as const,
          root,
          scaleTypeId,
          shapeId,
        })),
    )
    return { combos, rootSpellings: new Map() }
  }
  // Combos whose rule is missing (a deleted custom rule) or unsatisfiable
  // (§4: e.g. a triad against a bass-on-the-7th rule) are dropped rather
  // than crashing prompt creation — the preset editor warns about them, but
  // a saved preset may still contain some. Satisfiability is root-
  // independent, so it's checked once per (type × rule).
  const satisfiable = new Map<string, boolean>()
  const isSatisfiable = (typeId: ChordTypeId, voicingId: string): boolean => {
    const cacheKey = `${typeId}:${voicingId}`
    let ok = satisfiable.get(cacheKey)
    if (ok === undefined) {
      const rule = voicings.get(voicingId)
      ok =
        rule !== undefined &&
        realizeVoicing({ root: 0, type: getChordType(typeId) }, rule) !== null
      satisfiable.set(cacheKey, ok)
    }
    return ok
  }
  const combos: ChordCombo[] = poolChords(preset.pool).flatMap(
    ({ root, typeId }) =>
      preset.voicingIds
        .filter((voicingId) => isSatisfiable(typeId, voicingId))
        .map((voicingId) => ({ root, typeId, voicingId })),
  )
  const rootSpellings = new Map<PitchClass, NoteSpelling>()
  const pool = preset.pool
  if (pool.kind === 'diatonic') {
    MAJOR_SCALE_SEMITONES.forEach((_, degree) => {
      const spelling = spellMajorScaleDegree(pool.key, degree)
      rootSpellings.set(spelling.pc, spelling)
    })
  }
  return { combos, rootSpellings }
}

export const DEFAULT_DIATONIC_KEY: PitchClass = 0 // C major

// The 7 built-in chord presets (§4) — all `any` voicing except the inversion
// drills. The diatonic preset's key comes from the top-bar key picker.
export function builtInPresets(
  diatonicKey: PitchClass = DEFAULT_DIATONIC_KEY,
): readonly ChordPreset[] {
  const product = (chordTypes: readonly ChordTypeId[]): ChordPool => ({
    kind: 'product',
    roots: ALL_PITCH_CLASSES,
    chordTypes,
  })
  return [
    {
      id: 'major-triads',
      name: 'Major triads',
      pool: product(['maj']),
      voicingIds: ['any'],
    },
    {
      id: 'minor-triads',
      name: 'Minor triads',
      pool: product(['min']),
      voicingIds: ['any'],
    },
    {
      id: 'major-minor-triads',
      name: 'Major + minor triads',
      pool: product(['maj', 'min']),
      voicingIds: ['any'],
    },
    {
      id: 'seventh-chords',
      name: 'Seventh chords',
      pool: product(['maj7', 'min7', 'dom7']),
      voicingIds: ['any'],
    },
    {
      id: 'triad-qualities',
      name: 'All triad qualities',
      pool: product(['maj', 'min', 'dim', 'aug', 'sus2', 'sus4']),
      voicingIds: ['any'],
    },
    {
      id: 'diatonic',
      name: 'Diatonic triads in a key',
      pool: { kind: 'diatonic', key: pitchClass(diatonicKey) },
      voicingIds: ['any'],
    },
    {
      id: 'inversion-drills',
      name: 'Inversion drills',
      pool: product(['maj', 'min']),
      voicingIds: ['first-inversion', 'second-inversion'],
    },
  ]
}

// The 8 built-in scale presets (§4), all 12 roots. The longer shapes get a
// couple of built-ins so they are reachable without the editor; any other
// combination is a custom preset.
export function builtInScalePresets(): readonly ScalePreset[] {
  const preset = (
    id: string,
    name: string,
    scaleTypes: readonly ScaleTypeId[],
    shapeId: ScaleShapeId,
  ): ScalePreset => ({
    kind: 'scale',
    id,
    name,
    pool: { kind: 'product', roots: ALL_PITCH_CLASSES, scaleTypes },
    shapeIds: [shapeId],
  })
  const minorForms: readonly ScaleTypeId[] = [
    'natural-minor',
    'harmonic-minor',
    'melodic-minor',
  ]
  return [
    preset('major-scales', 'Major scales', ['major'], 'up-1'),
    preset(
      'natural-minor-scales',
      'Natural minor scales',
      ['natural-minor'],
      'up-1',
    ),
    preset(
      'harmonic-minor-scales',
      'Harmonic minor scales',
      ['harmonic-minor'],
      'up-1',
    ),
    preset(
      'melodic-minor-scales',
      'Melodic minor scales',
      ['melodic-minor'],
      'up-1',
    ),
    preset('minor-scales', 'All minor forms', minorForms, 'up-1'),
    preset(
      'major-scales-2-octaves',
      'Major scales · 2 octaves ↕',
      ['major'],
      'updown-2',
    ),
    preset(
      'minor-scales-2-octaves',
      'Minor scales · 2 octaves ↕',
      minorForms,
      'updown-2',
    ),
    preset('major-block-scales', 'Major block scales', ['major'], 'block'),
  ]
}
