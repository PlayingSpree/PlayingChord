import { describe, expect, it } from 'vitest'
import { matches } from '../theory'
import { MAJOR_TRIADS_COMBOS } from './combos'
import { createPrompt } from './prompts'

describe('createPrompt', () => {
  it('builds a full prompt for a combo', () => {
    const prompt = createPrompt({ root: 0, typeId: 'maj', voicingId: 'any' })
    expect(prompt.displayName).toBe('C maj')
    expect(prompt.chord.type.id).toBe('maj')
    expect(prompt.voicing.id).toBe('any')
    expect(prompt.example).toEqual([60, 64, 67]) // deterministic, near middle C
  })

  it('every hardcoded major-triad combo yields an example satisfying its rule', () => {
    for (const combo of MAJOR_TRIADS_COMBOS) {
      const prompt = createPrompt(combo)
      expect(matches(prompt.example, prompt.chord, prompt.voicing)).toBe(true)
    }
  })

  it('throws for a voicing id not in the library', () => {
    expect(() =>
      createPrompt({ root: 0, typeId: 'maj', voicingId: 'unknown-rule' }),
    ).toThrow()
  })
})
