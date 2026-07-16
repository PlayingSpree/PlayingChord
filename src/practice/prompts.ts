import {
  chordDisplayName,
  getBuiltInVoicingRule,
  getChordType,
  realizeVoicing,
  spellRoot,
  type Chord,
  type NoteSpelling,
  type VoicingRule,
} from '../theory'
import type { Combo } from './combos'

// What the user is asked to play (DESIGN.md §3.4). The name is the prompt;
// `example` is one concrete voicing for the staff/hint reveal — illustrative
// only, matching is always against the rule.
export interface Prompt {
  chord: Chord
  voicing: VoicingRule
  displayName: string
  // How this prompt spells its root — diatonic presets spell from the key
  // (§3.5); the Phase 8 staff derives chord-tone spellings from this.
  rootSpelling: NoteSpelling
  example: number[]
}

export function createPrompt(
  combo: Combo,
  rootSpelling?: NoteSpelling,
): Prompt {
  const chord: Chord = { root: combo.root, type: getChordType(combo.typeId) }
  const voicing = getBuiltInVoicingRule(combo.voicingId)
  const example = realizeVoicing(chord, voicing)
  if (example === null) {
    // Unsatisfiable combos are kept out of pools by the Phase 5/9 preset
    // validation (DESIGN.md §4); reaching this is a programming error.
    throw new Error(
      `Unsatisfiable combo: ${chordDisplayName(chord)} × ${voicing.id}`,
    )
  }
  const spelling = rootSpelling ?? spellRoot(combo.root)
  return {
    chord,
    voicing,
    displayName: chordDisplayName(chord, spelling),
    rootSpelling: spelling,
    example,
  }
}
