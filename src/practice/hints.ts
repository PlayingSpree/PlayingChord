import {
  chordPitchClasses,
  chordToneAt,
  isPatternRule,
  pitchClass,
  resolvePattern,
  type Chord,
  type ConstraintVoicingRule,
  type MatchSettings,
  type PatternVoicingRule,
  type PitchClass,
} from '../theory'
import type { Prompt } from './prompts'

// Progressive hints (DESIGN.md §6.4): recall first, answer later. Misses 1–2
// mark the wrong played keys — or, when every played key is a chord tone,
// name the failed constraint as text; miss 3+ reveals the example voicing.
export const REVEAL_AFTER_MISSES = 3

export type Hint =
  // Mark these held keys as not belonging (color + icon on the keyboard).
  | { kind: 'wrong-keys'; notes: number[] }
  // All played keys are chord tones — say what failed instead.
  | { kind: 'constraint'; text: string }
  // Overlay the prompt's example voicing (and the staff, once it exists).
  | { kind: 'reveal'; notes: number[] }

export function computeHint(
  missCount: number,
  held: ReadonlySet<number>,
  prompt: Prompt,
  settings: MatchSettings,
): Hint {
  if (missCount >= REVEAL_AFTER_MISSES) {
    return { kind: 'reveal', notes: [...prompt.example] }
  }
  if (isPatternRule(prompt.voicing)) {
    return computePatternHint(held, prompt.chord, prompt.voicing)
  }
  // With strict extra notes off, foreign keys are tolerated by the matcher,
  // so they are never what failed — fall through to the constraint text.
  if (settings.strictExtraNotes) {
    const chordPcs = new Set(chordPitchClasses(prompt.chord))
    const wrong = [...held]
      .filter((note) => !chordPcs.has(pitchClass(note)))
      .sort((a, b) => a - b)
    if (wrong.length > 0) return { kind: 'wrong-keys', notes: wrong }
  }
  return {
    kind: 'constraint',
    text: describeFailedConstraint(
      held,
      prompt.chord,
      prompt.voicing,
      settings,
    ),
  }
}

// Pattern rules are exact by nature (DESIGN.md §3.3) — the doubling/strict-
// extra-notes settings don't apply. A held note whose pitch class isn't
// anywhere in the pattern is unambiguously wrong (wrong-keys, same UX as the
// constraint case); otherwise the pcs are all valid members but the *order*
// (or count) is what's broken, which is named as text instead.
function computePatternHint(
  held: ReadonlySet<number>,
  chord: Chord,
  rule: PatternVoicingRule,
): Hint {
  const target = resolvePattern(chord, rule)
  const notes = [...held]
  if (target === null) {
    return { kind: 'constraint', text: 'Does not match the voicing rule' }
  }
  const targetPcs = new Set(target)
  const foreign = notes
    .filter((note) => !targetPcs.has(pitchClass(note)))
    .sort((a, b) => a - b)
  if (foreign.length > 0) return { kind: 'wrong-keys', notes: foreign }
  if (notes.length > target.length) {
    return { kind: 'constraint', text: 'Too many notes for this pattern' }
  }
  return { kind: 'constraint', text: 'Notes out of order for this pattern' }
}

function degreeName(degree: number): string {
  if (degree === 1) return 'root'
  if (degree === 2) return '2nd'
  if (degree === 3) return '3rd'
  return `${degree}th`
}

// Names one failed constraint, in never-misleading order: a violated doubling
// can't be fixed by adding notes, so it's named before missing tones; missing
// tones come before bass/span, which can't be judged until every tone is down.
export function describeFailedConstraint(
  held: Iterable<number>,
  chord: Chord,
  rule: ConstraintVoicingRule,
  settings: MatchSettings,
): string {
  const notes = [...held]
  const counts = new Map<PitchClass, number>()
  for (const note of notes) {
    const pc = pitchClass(note)
    counts.set(pc, (counts.get(pc) ?? 0) + 1)
  }
  const chordPcs = chordPitchClasses(chord)

  const doubling = settings.allowOctaveDoubling ? rule.doubling : 'exact'
  if (
    doubling === 'exact' &&
    chordPcs.some((pc) => (counts.get(pc) ?? 0) > 1)
  ) {
    return 'Octave doubling not allowed'
  }

  const missing = chord.type.intervals.filter((_, i) => {
    const pc = chordPcs[i]
    return pc !== undefined && !counts.has(pc)
  })
  if (missing.length > 0) {
    return `Missing the ${missing.map((i) => degreeName(i.degree)).join(' and ')}`
  }

  if (rule.bass.kind === 'chordTone' && notes.length > 0) {
    const target = chordToneAt(chord, rule.bass.degree)
    const interval = chord.type.intervals[rule.bass.degree]
    if (
      target !== undefined &&
      interval !== undefined &&
      pitchClass(Math.min(...notes)) !== target
    ) {
      return `Bass must be the ${degreeName(interval.degree)}`
    }
  }

  if (notes.length > 0) {
    const span = Math.max(...notes) - Math.min(...notes)
    if (rule.span?.max !== undefined && span > rule.span.max) {
      return 'Span too wide'
    }
    if (rule.span?.min !== undefined && span < rule.span.min) {
      return 'Span too narrow'
    }
  }

  // A miss only latches when something above failed; defensive fallback.
  return 'Does not match the voicing rule'
}
