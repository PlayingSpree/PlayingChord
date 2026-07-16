// Custom-content helpers for the Phase 9 editors (DESIGN.md §4, §7): id
// generation for user-created rules/presets and the preset-editor
// compatibility validation. Pure TS — the editors render what this reports.

import {
  getChordType,
  realizeVoicing,
  type BassConstraint,
  type ChordTypeId,
  type VoicingLibrary,
  type VoicingRule,
} from '../theory'
import { poolChords, type Preset } from './presets'

// Human labels for bass-constraint degrees (index into ChordType.intervals),
// shared by the voicing builder's picker and rule summaries. The tone a
// degree names varies by chord type, so labels stay ordinal.
const BASS_DEGREE_LABELS: readonly string[] = [
  'Root (root position)',
  '2nd chord tone (1st inversion)',
  '3rd chord tone (2nd inversion)',
  '4th chord tone (3rd inversion)',
  '5th chord tone',
  '6th chord tone',
  '7th chord tone',
]

// Degrees the builder offers — everything a built-in chord type can satisfy
// (dom13 has 7 tones); the storage sanitizer enforces the same bound.
export const EDITOR_BASS_DEGREES: readonly number[] = BASS_DEGREE_LABELS.map(
  (_, degree) => degree,
)

export function bassConstraintLabel(bass: BassConstraint): string {
  if (bass.kind === 'any') return 'Any lowest note'
  return BASS_DEGREE_LABELS[bass.degree] ?? `Chord tone ${bass.degree + 1}`
}

// One-line human summary of a rule, for the library list and the builder's
// live preview.
export function describeVoicingRule(rule: VoicingRule): string {
  const parts: string[] = []
  parts.push(
    rule.bass.kind === 'any'
      ? 'any bass'
      : `bass: ${bassConstraintLabel(rule.bass)}`,
  )
  const { min, max } = rule.span ?? {}
  if (min !== undefined && max !== undefined) {
    parts.push(`span ${min}–${max} st`)
  } else if (min !== undefined) {
    parts.push(`span ≥ ${min} st`)
  } else if (max !== undefined) {
    parts.push(`span ≤ ${max} st`)
  }
  parts.push(rule.doubling === 'exact' ? 'exact doubling' : 'doubling allowed')
  return parts.join(' · ')
}

// Fresh ids for user-created library items. Prefixed so they can never
// collide with built-in ids ('any', 'major-triads', …), random so two
// browser profiles naming a preset the same still export distinct ids —
// import conflict detection (§4) keys on ids, not names.
export function newLibraryId(
  prefix: string,
  taken: ReadonlySet<string>,
  rng: () => number = Math.random,
): string {
  for (;;) {
    const id = `${prefix}-${Math.floor(rng() * 36 ** 6)
      .toString(36)
      .padStart(6, '0')}`
    if (!taken.has(id)) return id
  }
}

export type PresetWarningKind =
  // The rule id resolves to nothing — a deleted custom rule.
  | 'missing-rule'
  // No voicing of this chord type can satisfy the rule (realizeVoicing
  // finds none): e.g. a triad against a bass-on-the-4th-tone rule.
  | 'unsatisfiable'
  // Satisfiable, but only barely: a 5+-tone chord under a span max below an
  // octave fits solely as a tight cluster (the §4 dom13-vs-closed example —
  // technically playable, unlikely to be what the user wants to drill).
  | 'cluster-only'

export interface PresetWarning {
  typeId: ChordTypeId | null // null: the warning concerns the rule itself
  voicingId: string
  kind: PresetWarningKind
  message: string
}

const CLUSTER_SPAN_MAX = 11 // one octave: the `closed` rule's span
const CLUSTER_TONE_COUNT = 5

// The §4 preset-editor validation: one warning per (chord type × voicing
// rule) pairing in the preset that can't — or can only awkwardly — be
// satisfied. Satisfiability is root-independent, so pairs are checked once.
export function presetWarnings(
  preset: Preset,
  voicings: VoicingLibrary,
): PresetWarning[] {
  const typeIds = [...new Set(poolChords(preset.pool).map((c) => c.typeId))]
  const warnings: PresetWarning[] = []
  for (const voicingId of preset.voicingIds) {
    const rule = voicings.get(voicingId)
    if (rule === undefined) {
      warnings.push({
        typeId: null,
        voicingId,
        kind: 'missing-rule',
        message: `Voicing rule “${voicingId}” no longer exists`,
      })
      continue
    }
    for (const typeId of typeIds) {
      const type = getChordType(typeId)
      if (realizeVoicing({ root: 0, type }, rule) === null) {
        warnings.push({
          typeId,
          voicingId,
          kind: 'unsatisfiable',
          message: `${type.name} can’t satisfy “${rule.name}” — these combos won’t be drilled`,
        })
      } else if (
        type.intervals.length >= CLUSTER_TONE_COUNT &&
        rule.span?.max !== undefined &&
        rule.span.max <= CLUSTER_SPAN_MAX
      ) {
        warnings.push({
          typeId,
          voicingId,
          kind: 'cluster-only',
          message: `${type.name} fits “${rule.name}” only as a one-octave cluster`,
        })
      }
    }
  }
  return warnings
}
