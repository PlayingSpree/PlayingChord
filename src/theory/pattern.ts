// Two-hand pattern voicing rules (DESIGN.md §3.3): a rule spells the voicing
// out as chord degrees from the bottom, per hand — e.g. LH 1-5, RH 1-2-5 —
// rather than composing bass/span/doubling constraints. Pure degree
// resolution and matching logic; realize.ts and matcher.ts hold the branches
// that call into this.

import { pitchClass, type PitchClass } from './notes'
import { MAJOR_SCALE_SEMITONES } from './spelling'
import type { Chord } from './chordTypes'
import type { PatternVoicingRule } from './voicingRules'

// Resolves one pattern degree (1 = root, 2 = a step above it, ...) to a
// pitch class for a specific chord. Odd degree classes — 1/3/5/7, root
// through seventh — must come from the chord's own quality (a triad has no
// 7th, so degree 7 is unsatisfiable on it: undefined, same "incompatible
// pairing" the preset editor already warns about for constraint rules).
// Even degree classes — 2/4/6, the "color" degrees also spelled 9/11/13 —
// use the chord's own interval when it has one (a dom9's 9th, a maj6's 6th)
// and otherwise fall back to the plain major scale above the root, so e.g.
// `1-2-5` (an add-2 shape) is satisfiable over an ordinary triad. Degrees
// above 7 fold to 1-7 an octave up (9 -> 2, 11 -> 4, 13 -> 6, ...).
export function resolvePatternDegree(
  chord: Chord,
  degree: number,
): PitchClass | undefined {
  if (degree < 1) return undefined
  const degreeClass = ((degree - 1) % 7) + 1
  const interval = chord.type.intervals.find(
    (i) => ((i.degree - 1) % 7) + 1 === degreeClass,
  )
  if (interval) return pitchClass(chord.root + interval.semitones)
  if (degreeClass % 2 === 0) {
    const semitones = MAJOR_SCALE_SEMITONES[degreeClass - 1]
    if (semitones !== undefined) return pitchClass(chord.root + semitones)
  }
  return undefined
}

// The full ascending sequence a pattern rule expects: left hand degrees then
// right hand degrees, each resolved against the chord. `null` when any
// degree is unsatisfiable for this chord type.
export function resolvePattern(
  chord: Chord,
  rule: PatternVoicingRule,
): PitchClass[] | null {
  const degrees = [...rule.leftHand, ...rule.rightHand]
  const resolved: PitchClass[] = []
  for (const degree of degrees) {
    const pc = resolvePatternDegree(chord, degree)
    if (pc === undefined) return null
    resolved.push(pc)
  }
  return resolved
}

// True when `held` (already sorted ascending and read as pitch classes)
// could still become a full match by adding more notes, never removing any
// — i.e. it embeds as an in-order subsequence of `target`. A held sequence
// that isn't a subsequence has a note whose relative position can never be
// fixed by pressing more keys (DESIGN.md §6.2's "no additional key press
// could fix it"). Also true for a length-equal exact match, since a
// sequence is trivially a subsequence of itself.
export function patternIsExtendable(
  held: readonly PitchClass[],
  target: readonly PitchClass[],
): boolean {
  let ti = 0
  for (const pc of held) {
    while (ti < target.length && target[ti] !== pc) ti++
    if (ti >= target.length) return false
    ti++
  }
  return true
}
