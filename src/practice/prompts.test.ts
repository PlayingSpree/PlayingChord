import { describe, expect, it } from 'vitest'
import { matches, spellMajorScaleDegree } from '../theory'
import { createPrompt } from './prompts'

describe('createPrompt', () => {
  it('builds a full prompt for a combo', () => {
    const prompt = createPrompt({ root: 0, typeId: 'maj', voicingId: 'any' })
    expect(prompt.displayName).toBe('C maj')
    expect(prompt.chord.type.id).toBe('maj')
    expect(prompt.voicing.id).toBe('any')
    expect(prompt.example).toEqual([60, 64, 67]) // deterministic, near middle C
  })

  it('every major-triad combo yields an example satisfying its rule', () => {
    for (let root = 0; root < 12; root++) {
      const prompt = createPrompt({ root, typeId: 'maj', voicingId: 'any' })
      expect(matches(prompt.example, prompt.chord, prompt.voicing)).toBe(true)
    }
  })

  it('spells the root with the default policy unless one is passed', () => {
    const combo = { root: 3, typeId: 'min', voicingId: 'any' } as const
    expect(createPrompt(combo).displayName).toBe('E♭ min')

    // Diatonic presets pass the key-derived spelling (§3.5): iii of B major.
    const inKey = createPrompt(combo, spellMajorScaleDegree(11, 2))
    expect(inKey.displayName).toBe('D♯ min')
    expect(inKey.rootSpelling.letter).toBe('D')
  })

  it('throws for a voicing id not in the library', () => {
    expect(() =>
      createPrompt({ root: 0, typeId: 'maj', voicingId: 'unknown-rule' }),
    ).toThrow()
  })
})
