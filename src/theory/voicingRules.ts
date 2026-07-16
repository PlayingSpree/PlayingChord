// Voicing rules are composable, id'd data (DESIGN.md §3.3) — user-defined
// rules join the same library and never require matcher changes.

export type BassConstraint =
  { kind: 'any' } | { kind: 'chordTone'; degree: number } // index into ChordType.intervals

export interface SpanConstraint {
  min?: number // semitones between lowest and highest held note
  max?: number
}

export interface VoicingRule {
  id: string
  name: string
  bass: BassConstraint
  span?: SpanConstraint
  doubling: 'allowed' | 'exact'
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
