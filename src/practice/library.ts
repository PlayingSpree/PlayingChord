// Custom-content helpers for the Phase 9 editors (DESIGN.md §4, §7): id
// generation for user-created rules/presets and the preset-editor
// compatibility validation. Pure TS — the editors render what this reports.

import {
  getChordType,
  isPatternRule,
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
  if (isPatternRule(rule)) {
    const parts: string[] = []
    if (rule.leftHand.length > 0) parts.push(`LH ${rule.leftHand.join('-')}`)
    if (rule.rightHand.length > 0) parts.push(`RH ${rule.rightHand.join('-')}`)
    return parts.length > 0 ? parts.join(' · ') : 'empty pattern'
  }
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

// Bounds for the pattern-mode builder (§4/§7): degrees stay within what
// resolvePatternDegree treats as meaningful (13 = a compound 6th, the
// largest built-in extension), and a hand caps at 5 notes — a stretch, but a
// playable one. The storage sanitizer enforces the same bounds independently
// (schema.ts doesn't import from practice/, same as MAX_BASS_DEGREE below).
export const EDITOR_MAX_PATTERN_DEGREE = 13
export const EDITOR_MAX_HAND_NOTES = 5

// Parses a hand's degree text ("1-5", "1 2 5", "1,2,5" all accepted) into
// degrees; null on anything malformed (blocks saving in the builder). An
// empty/blank string is a valid empty hand (one-hand voicings).
export function parseHandDegrees(raw: string): number[] | null {
  const trimmed = raw.trim()
  if (trimmed === '') return []
  const degrees: number[] = []
  for (const token of trimmed.split(/[\s,-]+/)) {
    if (token === '') continue
    const degree = Number(token)
    if (
      !Number.isInteger(degree) ||
      degree < 1 ||
      degree > EDITOR_MAX_PATTERN_DEGREE
    ) {
      return null
    }
    degrees.push(degree)
  }
  return degrees
}

// Compact "1-5 + 1-2-5" shape label (no LH/RH prefixes) — the pattern
// builder's name-autofill when the user hasn't typed one.
export function patternShapeLabel(
  leftHand: readonly number[],
  rightHand: readonly number[],
): string {
  return [leftHand, rightHand]
    .filter((hand) => hand.length > 0)
    .map((hand) => hand.join('-'))
    .join(' + ')
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
        !isPatternRule(rule) &&
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
