import {
  BUILT_IN_VOICING_LIBRARY,
  chordDisplayName,
  getChordType,
  realizeVoicing,
  spellRoot,
  type Chord,
  type NoteSpelling,
  type VoicingLibrary,
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
  voicings: VoicingLibrary = BUILT_IN_VOICING_LIBRARY,
): Prompt {
  const chord: Chord = { root: combo.root, type: getChordType(combo.typeId) }
  const voicing = voicings.get(combo.voicingId)
  if (voicing === undefined) {
    throw new Error(`Unknown voicing rule: ${combo.voicingId}`)
  }
  const example = realizeVoicing(chord, voicing)
  if (example === null) {
    // Unsatisfiable combos are filtered out during preset expansion
    // (DESIGN.md §4); reaching this is a programming error.
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

// Compact display label for a combo outside a live prompt (stats bar, the
// Phase 7 review lists): chord name plus the voicing name — omitted for the
// `any` rule, same as the prompt area (§7).
export function comboLabel(
  combo: Combo,
  rootSpelling?: NoteSpelling,
  voicings: VoicingLibrary = BUILT_IN_VOICING_LIBRARY,
): string {
  const chord: Chord = { root: combo.root, type: getChordType(combo.typeId) }
  const name = chordDisplayName(chord, rootSpelling ?? spellRoot(combo.root))
  if (combo.voicingId === 'any') return name
  const voicingName = voicings.get(combo.voicingId)?.name ?? combo.voicingId
  return `${name} — ${voicingName}`
}
