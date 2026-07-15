import { describe, expect, it } from 'vitest'
import { ALL_PITCH_CLASSES } from './notes'
import {
  CHORD_TYPES,
  getChordType,
  type Chord,
  type ChordTypeId,
} from './chordTypes'
import { BUILT_IN_VOICING_RULES, getBuiltInVoicingRule } from './voicingRules'
import { matches } from './matcher'
import { realizeVoicing } from './realize'

const chord = (root: number, id: ChordTypeId): Chord => ({
  root,
  type: getChordType(id),
})

describe('realizeVoicing — property over every built-in combination', () => {
  it('produces a valid, deterministic, playable voicing for all type × rule × root', () => {
    for (const type of CHORD_TYPES) {
      for (const rule of BUILT_IN_VOICING_RULES) {
        for (const root of ALL_PITCH_CLASSES) {
          const c: Chord = { root, type }
          const notes = realizeVoicing(c, rule)
          const label = `${type.id} root=${root} rule=${rule.id}`

          // Every built-in combination is satisfiable (all types have ≥ 3
          // tones, so even second-inversion has a valid bass index).
          expect(notes, label).not.toBeNull()
          if (!notes) continue

          expect(matches(notes, c, rule), label).toBe(true)
          expect(
            [...notes].sort((a, b) => a - b),
            label,
          ).toEqual(notes)
          // Playable on an 88-key keyboard (A0=21 … C8=108).
          expect(Math.min(...notes), label).toBeGreaterThanOrEqual(21)
          expect(Math.max(...notes), label).toBeLessThanOrEqual(108)
          // Deterministic per prompt (§3.4).
          expect(realizeVoicing(c, rule), label).toEqual(notes)
        }
      }
    }
  })
})

describe('realizeVoicing — spot checks near middle C', () => {
  it('C maj root position → C4 E4 G4', () => {
    expect(
      realizeVoicing(chord(0, 'maj'), getBuiltInVoicingRule('root-position')),
    ).toEqual([60, 64, 67])
  })

  it('C maj first inversion → E3 G3 C4', () => {
    expect(
      realizeVoicing(chord(0, 'maj'), getBuiltInVoicingRule('first-inversion')),
    ).toEqual([52, 55, 60])
  })

  it('C maj second inversion → G3 C4 E4', () => {
    expect(
      realizeVoicing(
        chord(0, 'maj'),
        getBuiltInVoicingRule('second-inversion'),
      ),
    ).toEqual([55, 60, 64])
  })

  it('C maj7 closed → C4 E4 G4 B4', () => {
    expect(
      realizeVoicing(chord(0, 'maj7'), getBuiltInVoicingRule('closed')),
    ).toEqual([60, 64, 67, 71])
  })

  it('C maj open spreads beyond an octave without doubling', () => {
    expect(
      realizeVoicing(chord(0, 'maj'), getBuiltInVoicingRule('open')),
    ).toEqual([48, 55, 64])
  })

  it('returns null when the bass degree does not exist for the type', () => {
    expect(
      realizeVoicing(chord(0, 'maj'), {
        id: 'x',
        name: 'x',
        bass: { kind: 'chordTone', degree: 5 },
        doubling: 'allowed',
      }),
    ).toBeNull()
  })

  it('returns null for an unsatisfiable span window', () => {
    // maj7 has 4 distinct tones; they cannot fit in a span of 5 semitones.
    expect(
      realizeVoicing(chord(0, 'maj7'), {
        id: 'x',
        name: 'x',
        bass: { kind: 'any' },
        span: { max: 5 },
        doubling: 'exact',
      }),
    ).toBeNull()
  })
})
