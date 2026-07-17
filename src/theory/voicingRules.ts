// Voicing rules are composable, id'd data (DESIGN.md §3.3) — user-defined
// rules join the same library and never require matcher changes.

export type BassConstraint =
  { kind: 'any' } | { kind: 'chordTone'; degree: number } // index into ChordType.intervals

export interface SpanConstraint {
  min?: number // semitones between lowest and highest held note
  max?: number
}

// A constraint rule describes properties any satisfying voicing must have.
// `kind` is optional so pre-pattern persisted rules (and the built-ins below)
// stay valid without migration; absence means 'constraint'.
export interface ConstraintVoicingRule {
  kind?: 'constraint'
  id: string
  name: string
  bass: BassConstraint
  span?: SpanConstraint
  doubling: 'allowed' | 'exact'
}

// A pattern rule spells the voicing out explicitly as chord degrees from the
// bottom, per hand (e.g. LH 1-5, RH 1-2-5) — for two-hand shapes constraint
// rules can't express. Matching is exact (same note count, ascending pitch
// classes equal to the resolved pattern) but octave placement is free.
// Degree → pitch-class resolution lives in pattern.ts.
export interface PatternVoicingRule {
  kind: 'pattern'
  id: string
  name: string
  leftHand: readonly number[]
  rightHand: readonly number[]
}

export type VoicingRule = ConstraintVoicingRule | PatternVoicingRule

export function isPatternRule(rule: VoicingRule): rule is PatternVoicingRule {
  return rule.kind === 'pattern'
}

export const BUILT_IN_VOICING_RULES: readonly VoicingRule[] = [
  {
    id: 'any',
    name: 'Any Voicing',
    bass: { kind: 'any' },
    doubling: 'allowed',
  },
  {
    id: 'root-position',
    name: 'Root Position',
    bass: { kind: 'chordTone', degree: 0 },
    doubling: 'allowed',
  },
  {
    id: 'first-inversion',
    name: '1st Inversion',
    bass: { kind: 'chordTone', degree: 1 },
    doubling: 'allowed',
  },
  {
    id: 'second-inversion',
    name: '2nd Inversion',
    bass: { kind: 'chordTone', degree: 2 },
    doubling: 'allowed',
  },
  {
    id: 'closed',
    name: 'Closed Position',
    bass: { kind: 'chordTone', degree: 0 },
    span: { max: 11 },
    doubling: 'exact',
  },
  // `exact` doubling is deliberate: with doubling allowed, a closed voicing
  // plus an octave double (C4 E4 G4 C5) would span ≥ 12 and wrongly count as
  // "open" (DESIGN.md §3.3).
  {
    id: 'open',
    name: 'Open Position',
    bass: { kind: 'any' },
    span: { min: 12 },
    doubling: 'exact',
  },
]

const BY_ID = new Map(BUILT_IN_VOICING_RULES.map((rule) => [rule.id, rule]))

export function getBuiltInVoicingRule(id: string): VoicingRule {
  const rule = BY_ID.get(id)
  if (!rule) throw new Error(`Unknown built-in voicing rule: ${id}`)
  return rule
}

// The shared rule library (§3.3): built-ins plus user-defined rules from the
// Phase 9 voicing builder. Everything that resolves a voicingId — prompts,
// combo labels, preset expansion — goes through one of these so custom rules
// work everywhere built-ins do. Built-ins win an id collision; the storage
// sanitizer rejects such rules, so this only guards hand-crafted input.
export interface VoicingLibrary {
  rules: readonly VoicingRule[] // built-ins first, then customs
  get(id: string): VoicingRule | undefined
}

export function voicingLibrary(
  custom: readonly VoicingRule[] = [],
): VoicingLibrary {
  const byId = new Map(BY_ID)
  for (const rule of custom) {
    if (!byId.has(rule.id)) byId.set(rule.id, rule)
  }
  return { rules: [...byId.values()], get: (id) => byId.get(id) }
}

export const BUILT_IN_VOICING_LIBRARY: VoicingLibrary = voicingLibrary()
