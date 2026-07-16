import type { ChordTypeId, PitchClass } from '../theory'

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
