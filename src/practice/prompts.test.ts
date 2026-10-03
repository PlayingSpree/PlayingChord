import { describe, expect, it } from 'vitest'
import {
  matches,
  spellMajorScaleDegree,
  type Hand,
  type ScaleShapeId,
} from '../theory'
import { shapeHand, type ScaleCombo } from './combos'
import { comboLabel, comboLabelParts, createPrompt } from './prompts'

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

describe('scale prompts (§3.4, §3.6)', () => {
  it('builds a scale prompt from a scale combo', () => {
    const prompt = createPrompt({
      kind: 'scale',
      root: 3,
      scaleTypeId: 'natural-minor',
      shapeId: 'up-1',
      hand: 'rh',
    })
    expect(prompt.kind).toBe('scale')
    expect(prompt.displayName).toBe('E♭ natural minor')
    expect(prompt.shape.id).toBe('up-1')
    expect(prompt.example).toEqual([63, 65, 66, 68, 70, 71, 73, 75])
  })

  it('spells the scale from its own key, not a passed chord spelling', () => {
    const prompt = createPrompt({
      kind: 'scale',
      root: 8,
      scaleTypeId: 'harmonic-minor',
      shapeId: 'up-1',
      hand: 'rh',
    })
    expect(prompt.displayName).toBe('G♯ harmonic minor')
    expect(prompt.rootSpelling.letter).toBe('G')
  })

  const dMajor = (shapeId: ScaleShapeId, hand: Hand = 'rh'): ScaleCombo => ({
    kind: 'scale',
    root: 2,
    scaleTypeId: 'major',
    shapeId,
    hand: shapeHand(shapeId, hand),
  })

  it('labels the shape, except up-1, and always a run’s hand', () => {
    expect(comboLabel(dMajor('up-1'))).toBe('D major — RH')
    expect(comboLabel(dMajor('up-1', 'lh'))).toBe('D major — LH')
    expect(comboLabel(dMajor('updown-2', 'lh'))).toBe(
      'D major — 2 octaves ↕ · LH',
    )
    // A block has no hand to name.
    expect(comboLabel(dMajor('block'))).toBe('D major — block')
  })

  it('splits the label into name and shape for the upcoming preview', () => {
    expect(comboLabelParts(dMajor('up-1'))).toEqual({
      name: 'D major',
      variant: 'RH',
    })
    expect(comboLabelParts(dMajor('updown-2'))).toEqual({
      name: 'D major',
      variant: '2 octaves ↕ · RH',
    })
  })

  it('carries the combo’s hand onto the prompt', () => {
    expect(createPrompt(dMajor('up-2', 'lh')).hand).toBe('lh')
    expect(createPrompt(dMajor('block')).hand).toBeNull()
  })
})
