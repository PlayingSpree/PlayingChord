import { MIDDLE_C, pitchClass, type PitchClass } from './notes'
import { chordPitchClasses, chordToneAt, type Chord } from './chordTypes'
import {
  isPatternRule,
  type PatternVoicingRule,
  type VoicingRule,
} from './voicingRules'
import { matches } from './matcher'
import { resolvePattern } from './pattern'

// Picks one concrete, playable example voicing near middle C (DESIGN.md
// §3.4). Deterministic; illustrative only — matching is always against the
// rule, never against these notes. Returns null when no satisfying voicing
// is found (the §4 preset-editor validation treats that as incompatible).
export function realizeVoicing(
  chord: Chord,
  rule: VoicingRule,
): number[] | null {
  if (isPatternRule(rule)) return realizePattern(chord, rule)

  const pcs = [...new Set(chordPitchClasses(chord))]

  let bassPc: PitchClass
  if (rule.bass.kind === 'chordTone') {
    const target = chordToneAt(chord, rule.bass.degree)
    if (target === undefined) return null
    bassPc = target
  } else {
    bassPc = pitchClass(chord.root)
  }

  // Compact seed: bass plus every other chord tone in the octave above it
  // (span always ≤ 11), one note per pitch class.
  const bass = 48 + bassPc
  let notes = [
    bass,
    ...pcs
      .filter((pc) => pc !== bassPc)
      .map((pc) => bass + ((pc - bassPc + 12) % 12)),
  ].sort((a, b) => a - b)

  // Widen for a span minimum by raising the second-lowest note an octave at
  // a time — keeps the bass (and its constraint) intact.
  const spanMin = rule.span?.min
  if (spanMin !== undefined) {
    let guard = 0
    while (spanOf(notes) < spanMin && guard++ < 32) {
      const second = notes[1]
      if (second === undefined) return null
      notes[1] = second + 12
      notes.sort((a, b) => a - b)
    }
  }

  // Center near middle C; whole-octave shifts preserve span, doubling, and
  // every pitch class including the bass.
  const mean = notes.reduce((sum, n) => sum + n, 0) / notes.length
  const shift = Math.round((MIDDLE_C - mean) / 12) * 12
  notes = notes.map((n) => n + shift)

  return matches(notes, chord, rule) ? notes : null
}

function spanOf(notes: readonly number[]): number {
  return Math.max(...notes) - Math.min(...notes)
}

// Realizes a pattern rule: the tightest possible ascending stack of its
// resolved pitch-class sequence (each note is the nearest instance of its
// target pitch class above the previous one), then centered near middle C
// the same way as constraint rules. For LH 1-5 / RH 1-2-5 over C major this
// yields exactly C3 G3 · C4 D4 G4.
function realizePattern(
  chord: Chord,
  rule: PatternVoicingRule,
): number[] | null {
  const target = resolvePattern(chord, rule)
  const first = target?.[0]
  if (target === null || first === undefined) return null

  let prev = 48 + first
  const notes = [prev]
  for (let i = 1; i < target.length; i++) {
    const pc = target[i]
    if (pc === undefined) break
    const candidate = prev + 1
    const note = candidate + ((pc - pitchClass(candidate) + 12) % 12)
    notes.push(note)
    prev = note
  }

  const mean = notes.reduce((sum, n) => sum + n, 0) / notes.length
  const shift = Math.round((MIDDLE_C - mean) / 12) * 12
  const shifted = notes.map((n) => n + shift)

  return matches(shifted, chord, rule) ? shifted : null
}
