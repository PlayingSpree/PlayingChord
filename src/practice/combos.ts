import { ALL_PITCH_CLASSES, type PitchClass } from '../theory'
import type { ChordTypeId } from '../theory'

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

// Phase 3's hardcoded preset: major triads, all 12 roots, `any` voicing.
// Real presets and pool expansion arrive in Phase 5 (DESIGN.md §4).
export const MAJOR_TRIADS_COMBOS: readonly Combo[] = ALL_PITCH_CLASSES.map(
  (root) => ({ root, typeId: 'maj', voicingId: 'any' }),
)
