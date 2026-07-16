import {
  BUILT_IN_VOICING_RULES,
  CHORD_TYPES,
  type ChordTypeId,
  type PitchClass,
} from '../theory'

// A combo is the unit of generation and (from Phase 6) stats: one drillable
// (root, chord type, voicing rule) triple (DESIGN.md §5).
export interface Combo {
  root: PitchClass
  typeId: ChordTypeId
  voicingId: string
}

export function comboKey(combo: Combo): string {
  return `${combo.root}:${combo.typeId}:${combo.voicingId}`
}

const KNOWN_TYPE_IDS = new Set<string>(CHORD_TYPES.map((t) => t.id))
const KNOWN_VOICING_IDS = new Set(BUILT_IN_VOICING_RULES.map((r) => r.id))

// Inverse of comboKey, for walking persisted stat records back into combos
// (the §7 History view is keyed by stored keys, not a live preset). Returns
// null for keys that don't name a known type/voicing — stale keys from a
// removed chord type or a hand-edited store must not crash a display path.
export function parseComboKey(key: string): Combo | null {
  const [rootPart, typeId, ...voicingParts] = key.split(':')
  const voicingId = voicingParts.join(':')
  if (!rootPart || !typeId || voicingId === '') return null
  const root = Number(rootPart)
  if (!Number.isInteger(root) || root < 0 || root > 11) return null
  if (!KNOWN_TYPE_IDS.has(typeId) || !KNOWN_VOICING_IDS.has(voicingId)) {
    return null
  }
  return { root: root as PitchClass, typeId: typeId as ChordTypeId, voicingId }
}
