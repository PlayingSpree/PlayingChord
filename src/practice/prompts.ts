import {
  BUILT_IN_VOICING_LIBRARY,
  chordDisplayName,
  getChordType,
  getScaleShape,
  getScaleType,
  realizeScale,
  realizeVoicing,
  scaleDisplayName,
  spellRoot,
  spellScaleTonic,
  type Chord,
  type NoteSpelling,
  type Scale,
  type ScaleShape,
  type VoicingLibrary,
  type VoicingRule,
} from '../theory'
import {
  isScaleCombo,
  type ChordCombo,
  type Combo,
  type ScaleCombo,
} from './combos'

// What the user is asked to play (DESIGN.md §3.4). The name is the prompt;
// `example` is one concrete voicing for the staff/hint reveal — illustrative
// only, matching is always against the rule.
export interface ChordPrompt {
  kind: 'chord'
  chord: Chord
  voicing: VoicingRule
  displayName: string
  // How this prompt spells its root — diatonic presets spell from the key
  // (§3.5); the Phase 8 staff derives chord-tone spellings from this.
  rootSpelling: NoteSpelling
  example: number[]
}

// A scale prompt (§3.6): the scale, the shape it is played in, and the same
// name / example pair — the example being the full run from a root near
// middle C (for `block`, the one octave).
export interface ScalePrompt {
  kind: 'scale'
  scale: Scale
  shape: ScaleShape
  displayName: string
  rootSpelling: NoteSpelling
  example: number[]
}

export type Prompt = ChordPrompt | ScalePrompt

export function createPrompt(
  combo: ChordCombo,
  rootSpelling?: NoteSpelling,
  voicings?: VoicingLibrary,
): ChordPrompt
export function createPrompt(
  combo: ScaleCombo,
  rootSpelling?: NoteSpelling,
  voicings?: VoicingLibrary,
): ScalePrompt
export function createPrompt(
  combo: Combo,
  rootSpelling?: NoteSpelling,
  voicings?: VoicingLibrary,
): Prompt
export function createPrompt(
  combo: Combo,
  rootSpelling?: NoteSpelling,
  voicings: VoicingLibrary = BUILT_IN_VOICING_LIBRARY,
): Prompt {
  if (isScaleCombo(combo)) return createScalePrompt(combo)
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
    kind: 'chord',
    chord,
    voicing,
    displayName: chordDisplayName(chord, spelling),
    rootSpelling: spelling,
    example,
  }
}

// A scale spells itself — by degree, from its own key (§3.6) — so no pool
// spelling applies.
function createScalePrompt(combo: ScaleCombo): ScalePrompt {
  const scale = scaleOf(combo)
  const shape = getScaleShape(combo.shapeId)
  return {
    kind: 'scale',
    scale,
    shape,
    displayName: scaleDisplayName(scale),
    rootSpelling: spellScaleTonic(scale),
    example: realizeScale(scale, shape),
  }
}

function scaleOf(combo: ScaleCombo): Scale {
  return { root: combo.root, type: getScaleType(combo.scaleTypeId) }
}

// The prompt's grade scale (§3.6): every grade second, the §6.2 ceiling and
// the §7.3 slow/fast bars are this many times a chord's.
export function promptGradeScale(prompt: Prompt): number {
  return prompt.kind === 'scale' ? prompt.shape.gradeMultiplier : 1
}

// Compact display label for a combo outside a live prompt (stats bar, the
// Phase 7 review lists): the name plus the voicing or shape — omitted for
// the `any` rule and the `up-1` shape, same as the prompt area (§7.3).
export function comboLabel(
  combo: Combo,
  rootSpelling?: NoteSpelling,
  voicings: VoicingLibrary = BUILT_IN_VOICING_LIBRARY,
): string {
  if (isScaleCombo(combo)) {
    const name = scaleDisplayName(scaleOf(combo))
    if (combo.shapeId === 'up-1') return name
    return `${name} — ${getScaleShape(combo.shapeId).name}`
  }
  const chord: Chord = { root: combo.root, type: getChordType(combo.typeId) }
  const name = chordDisplayName(chord, rootSpelling ?? spellRoot(combo.root))
  if (combo.voicingId === 'any') return name
  const voicingName = voicings.get(combo.voicingId)?.name ?? combo.voicingId
  return `${name} — ${voicingName}`
}
