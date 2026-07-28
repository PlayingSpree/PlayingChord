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
  type VoicingLibrary,
} from '../theory'
import type { Combo } from './combos'

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
  // Full combos, voicing included — the only pool that can say "C in first
  // inversion but G in root position only". The path's material varies per
  // chord that way, which no pool above can express, so the derived
  // Repertoire preset (§3.2) is this kind and this kind exists for it. Never
  // persisted: the sanitizer rejects it, because the pool is a projection of
  // the path record rather than a second source of truth.
  | { kind: 'combos'; combos: readonly Combo[] }

export interface PoolChord {
  root: PitchClass
  typeId: ChordTypeId
}

// The pool kinds a *user* can author (§7.6's preset editor) — everything but
// `combos`, which only the path derives. Naming it keeps the editor's state
// from silently widening when a derived kind is added.
export type AuthorablePoolKind = Exclude<ChordPool['kind'], 'combos'>

export interface Preset {
  id: string
  name: string
  pool: ChordPool
  voicingIds: readonly string[] // references into the VoicingRule library (§3.3)
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
    case 'combos': {
      // Drops back to chords, deduped — several combos of one chord (C in two
      // inversions) are one chord here. Song mode and the preset description
      // read the pool this way; generation reads the combos directly.
      const seen = new Set<string>()
      const chords: PoolChord[] = []
      for (const { root, typeId } of pool.combos) {
        const key = `${root}:${typeId}`
        if (seen.has(key)) continue
        seen.add(key)
        chords.push({ root, typeId })
      }
      return chords
    }
  }
}

export interface ExpandedPreset {
  // One combo per (chord × voicing rule) — the §5 generation/stats unit.
  combos: readonly Combo[]
  // Display-only: the diatonic pool spells roots from its key (§3.5). Roots
  // absent from the map use the default root policy.
  rootSpellings: ReadonlyMap<PitchClass, NoteSpelling>
}

export function expandPreset(
  preset: Preset,
  voicings: VoicingLibrary = BUILT_IN_VOICING_LIBRARY,
): ExpandedPreset {
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
  // A `combos` pool already names its voicings, so preset.voicingIds is not a
  // cross product to take — it is ignored outright rather than intersected,
  // which is what lets the Repertoire preset carry per-chord voicings.
  const combos =
    preset.pool.kind === 'combos'
      ? preset.pool.combos.filter((combo) =>
          isSatisfiable(combo.typeId, combo.voicingId),
        )
      : poolChords(preset.pool).flatMap(({ root, typeId }) =>
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

// The 7 built-in presets (§4) — all `any` voicing except the inversion
// drills. The diatonic preset's key comes from the top-bar key picker.
export function builtInPresets(
  diatonicKey: PitchClass = DEFAULT_DIATONIC_KEY,
): readonly Preset[] {
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
