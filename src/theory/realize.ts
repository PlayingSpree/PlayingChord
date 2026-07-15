import { MIDDLE_C, pitchClass, type PitchClass } from './notes'
import { chordPitchClasses, chordToneAt, type Chord } from './chordTypes'
import type { VoicingRule } from './voicingRules'
import { matches } from './matcher'

// Picks one concrete, playable example voicing near middle C (DESIGN.md
// §3.4). Deterministic; illustrative only — matching is always against the
// rule, never against these notes. Returns null when no satisfying voicing
// is found (the §4 preset-editor validation treats that as incompatible).
export function realizeVoicing(
  chord: Chord,
  rule: VoicingRule,
): number[] | null {
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
