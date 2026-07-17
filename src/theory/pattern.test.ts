import { describe, expect, it } from 'vitest'
import { getChordType, type Chord, type ChordTypeId } from './chordTypes'
import {
  patternIsExtendable,
  resolvePattern,
  resolvePatternDegree,
} from './pattern'
import type { PatternVoicingRule } from './voicingRules'

const chord = (root: number, id: ChordTypeId): Chord => ({
  root,
  type: getChordType(id),
})

const cMaj = chord(0, 'maj')
const cMin = chord(0, 'min')

describe('resolvePatternDegree (§3.3)', () => {
  it('resolves odd degree classes from the chord itself', () => {
    expect(resolvePatternDegree(cMaj, 1)).toBe(0) // root
    expect(resolvePatternDegree(cMaj, 3)).toBe(4) // major 3rd
    expect(resolvePatternDegree(cMin, 3)).toBe(3) // minor 3rd — quality-aware
    expect(resolvePatternDegree(cMaj, 5)).toBe(7) // perfect 5th
  })

  it('a 7th is unsatisfiable on a triad (no fallback for odd degrees)', () => {
    expect(resolvePatternDegree(cMaj, 7)).toBeUndefined()
  })

  it('a 7th resolves from a seventh chord type', () => {
    expect(resolvePatternDegree(chord(0, 'dom7'), 7)).toBe(10)
    expect(resolvePatternDegree(chord(0, 'maj7'), 7)).toBe(11)
  })

  it('even degree classes fall back to the major scale on a plain triad', () => {
    expect(resolvePatternDegree(cMaj, 2)).toBe(2) // major 2nd
    expect(resolvePatternDegree(cMaj, 4)).toBe(5) // perfect 4th
    expect(resolvePatternDegree(cMaj, 6)).toBe(9) // major 6th
  })

  it("even degree classes prefer the chord's own tone when it has one", () => {
    // sus2 has an actual degree-2 tone; still a major 2nd here, but taken
    // from the chord's own interval rather than the fallback.
    expect(resolvePatternDegree(chord(0, 'sus2'), 2)).toBe(2)
    expect(resolvePatternDegree(chord(0, 'sus4'), 4)).toBe(5)
    expect(resolvePatternDegree(chord(0, 'maj6'), 6)).toBe(9)
    expect(resolvePatternDegree(chord(0, 'min6'), 6)).toBe(9)
  })

  it('compound degrees (8-13) fold to the same pitch class as 1-6', () => {
    expect(resolvePatternDegree(cMaj, 8)).toBe(resolvePatternDegree(cMaj, 1))
    expect(resolvePatternDegree(cMaj, 9)).toBe(resolvePatternDegree(cMaj, 2))
    expect(resolvePatternDegree(cMaj, 11)).toBe(resolvePatternDegree(cMaj, 4))
    expect(resolvePatternDegree(cMaj, 13)).toBe(resolvePatternDegree(cMaj, 6))
  })

  it('a real 9th/11th/13th interval resolves the same pitch class as its fallback', () => {
    expect(resolvePatternDegree(chord(0, 'dom9'), 9)).toBe(
      resolvePatternDegree(cMaj, 2),
    )
    expect(resolvePatternDegree(chord(0, 'dom11'), 11)).toBe(
      resolvePatternDegree(cMaj, 4),
    )
    expect(resolvePatternDegree(chord(0, 'dom13'), 13)).toBe(
      resolvePatternDegree(cMaj, 6),
    )
  })

  it('rejects degree 0 and negative degrees', () => {
    expect(resolvePatternDegree(cMaj, 0)).toBeUndefined()
    expect(resolvePatternDegree(cMaj, -1)).toBeUndefined()
  })
})

describe('resolvePattern', () => {
  const rule = (
    leftHand: number[],
    rightHand: number[],
  ): PatternVoicingRule => ({
    kind: 'pattern',
    id: 'x',
    name: 'x',
    leftHand,
    rightHand,
  })

  it('concatenates left then right hand, resolved per chord', () => {
    expect(resolvePattern(cMaj, rule([1, 5], [1, 2, 5]))).toEqual([
      0, 7, 0, 2, 7,
    ])
  })

  it('returns null when any degree is unsatisfiable for the chord', () => {
    expect(resolvePattern(cMaj, rule([1, 5], [7]))).toBeNull()
  })

  it('a one-hand pattern (empty other hand) resolves fine', () => {
    expect(resolvePattern(cMaj, rule([], [1, 3, 5]))).toEqual([0, 4, 7])
    expect(resolvePattern(cMaj, rule([1, 3, 5], []))).toEqual([0, 4, 7])
  })
})

describe('patternIsExtendable', () => {
  const target = [0, 7, 0, 2, 7] // C G C D G

  it('true for an empty held set', () => {
    expect(patternIsExtendable([], target)).toBe(true)
  })

  it('true for a prefix that could still be extended', () => {
    expect(patternIsExtendable([0], target)).toBe(true)
    expect(patternIsExtendable([0, 7], target)).toBe(true)
  })

  it('true for the exact full sequence', () => {
    expect(patternIsExtendable(target, target)).toBe(true)
  })

  it('true for a non-prefix subsequence (later notes played, order preserved)', () => {
    expect(patternIsExtendable([2, 7], target)).toBe(true) // D then G (positions 3,4)
  })

  it('false when a held note breaks the achievable order', () => {
    // Two G's held before any C follows the second C — impossible: after
    // matching both G's (positions 1 and 4), nothing is left to match.
    expect(patternIsExtendable([7, 7, 7], target)).toBe(false)
  })

  it('false for a foreign pitch class', () => {
    expect(patternIsExtendable([1], target)).toBe(false)
  })

  it('false when there are more held notes than the target has', () => {
    expect(patternIsExtendable([0, 7, 0, 2, 7, 0], target)).toBe(false)
  })
})
