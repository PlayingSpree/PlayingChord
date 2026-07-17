import { pitchClass, type PitchClass } from './notes'
import { chordPitchClasses, chordToneAt, type Chord } from './chordTypes'
import {
  isPatternRule,
  type ConstraintVoicingRule,
  type VoicingRule,
} from './voicingRules'
import { patternIsExtendable, resolvePattern } from './pattern'

// Global matching settings (DESIGN.md §6.3).
export interface MatchSettings {
  // When false, every rule's doubling behaves as 'exact'.
  allowOctaveDoubling: boolean
  // When false, extra non-chord-tone notes are tolerated as long as all
  // required chord tones are present.
  strictExtraNotes: boolean
}

export const DEFAULT_MATCH_SETTINGS: MatchSettings = {
  allowOctaveDoubling: true,
  strictExtraNotes: true,
}

function pcCounts(notes: readonly number[]): Map<PitchClass, number> {
  const counts = new Map<PitchClass, number>()
  for (const note of notes) {
    const pc = pitchClass(note)
    counts.set(pc, (counts.get(pc) ?? 0) + 1)
  }
  return counts
}

function effectiveDoubling(
  rule: ConstraintVoicingRule,
  settings: MatchSettings,
): 'allowed' | 'exact' {
  return settings.allowOctaveDoubling ? rule.doubling : 'exact'
}

// Rule-based matching (DESIGN.md §6.3): any voicing satisfying the rule
// counts — matching is never against a specific set of notes.
export function matches(
  held: Iterable<number>,
  chord: Chord,
  rule: VoicingRule,
  settings: MatchSettings = DEFAULT_MATCH_SETTINGS,
): boolean {
  const notes = [...held]
  if (notes.length === 0) return false

  if (isPatternRule(rule)) {
    const target = resolvePattern(chord, rule)
    if (target === null || notes.length !== target.length) return false
    const sortedPcs = notes
      .slice()
      .sort((a, b) => a - b)
      .map(pitchClass)
    return sortedPcs.every((pc, i) => pc === target[i])
  }

  const chordPcs = new Set(chordPitchClasses(chord))
  const counts = pcCounts(notes)

  for (const pc of chordPcs) {
    if (!counts.has(pc)) return false
  }

  if (settings.strictExtraNotes) {
    for (const pc of counts.keys()) {
      if (!chordPcs.has(pc)) return false
    }
  }

  if (effectiveDoubling(rule, settings) === 'exact') {
    for (const pc of chordPcs) {
      if ((counts.get(pc) ?? 0) > 1) return false
    }
  }

  if (rule.bass.kind === 'chordTone') {
    const target = chordToneAt(chord, rule.bass.degree)
    if (target === undefined) return false
    if (pitchClass(Math.min(...notes)) !== target) return false
  }

  const span = Math.max(...notes) - Math.min(...notes)
  if (rule.span?.min !== undefined && span < rule.span.min) return false
  if (rule.span?.max !== undefined && span > rule.span.max) return false

  return true
}

// Definitive miss detection (DESIGN.md §6.2): true only when no *additional*
// key press could make the attempt succeed — a non-chord pitch class is held
// (with strict extra notes on), the span max is exceeded, or doubling is
// violated under 'exact'. Anything releasable-but-wrong (wrong bass, unmet
// span min) is left to the stall timer.
export function isDefinitivelyUnsatisfiable(
  held: Iterable<number>,
  chord: Chord,
  rule: VoicingRule,
  settings: MatchSettings = DEFAULT_MATCH_SETTINGS,
): boolean {
  const notes = [...held]
  if (notes.length === 0) return false

  if (isPatternRule(rule)) {
    const target = resolvePattern(chord, rule)
    if (target === null) return true
    const sortedPcs = notes
      .slice()
      .sort((a, b) => a - b)
      .map(pitchClass)
    return !patternIsExtendable(sortedPcs, target)
  }

  const chordPcs = new Set(chordPitchClasses(chord))
  const counts = pcCounts(notes)

  if (settings.strictExtraNotes) {
    for (const pc of counts.keys()) {
      if (!chordPcs.has(pc)) return true
    }
  }

  if (rule.span?.max !== undefined) {
    const span = Math.max(...notes) - Math.min(...notes)
    if (span > rule.span.max) return true
  }

  if (effectiveDoubling(rule, settings) === 'exact') {
    for (const pc of chordPcs) {
      if ((counts.get(pc) ?? 0) > 1) return true
    }
  }

  return false
}

// How many held notes a *full* attempt needs (§6.2's stall condition: "the
// held set has at least the chord's tone count"). A pattern rule's full size
// is its own note count, which may differ from the chord's tone count
// (5 notes over a triad for `1-5 + 1-2-5`).
export function requiredNoteCount(chord: Chord, rule: VoicingRule): number {
  return isPatternRule(rule)
    ? rule.leftHand.length + rule.rightHand.length
    : chord.type.intervals.length
}
