import { describe, expect, it } from 'vitest'
import { voicingLibrary } from '../theory'
import {
  comboKey,
  comboKeySide,
  comboSide,
  parseComboKey,
  type Combo,
  type ScaleCombo,
} from './combos'

describe('parseComboKey', () => {
  it('round-trips comboKey', () => {
    const combo: Combo = { root: 3, typeId: 'min7', voicingId: 'any' }
    expect(parseComboKey(comboKey(combo))).toEqual(combo)
    const inversion: Combo = {
      root: 11,
      typeId: 'maj',
      voicingId: 'second-inversion',
    }
    expect(parseComboKey(comboKey(inversion))).toEqual(inversion)
  })

  it('rejects malformed or unknown keys', () => {
    expect(parseComboKey('')).toBeNull()
    expect(parseComboKey('garbage')).toBeNull()
    expect(parseComboKey('0:maj')).toBeNull() // no voicing
    expect(parseComboKey('12:maj:any')).toBeNull() // root out of range
    expect(parseComboKey('x:maj:any')).toBeNull()
    expect(parseComboKey('0:notatype:any')).toBeNull()
    expect(parseComboKey('0:maj:notavoicing')).toBeNull()
  })

  it('resolves custom voicing rules through the library (Phase 9)', () => {
    const lib = voicingLibrary([
      {
        id: 'rule-x1',
        name: 'Custom',
        bass: { kind: 'any' },
        doubling: 'exact',
      },
    ])
    const combo: Combo = { root: 5, typeId: 'maj7', voicingId: 'rule-x1' }
    expect(parseComboKey(comboKey(combo), lib)).toEqual(combo)
    // The same key is stale once the rule is gone (default library).
    expect(parseComboKey(comboKey(combo))).toBeNull()
  })
})

describe('scale combo keys (§8)', () => {
  it('keeps chord keys byte-identical to before scales', () => {
    expect(comboKey({ root: 3, typeId: 'min7', voicingId: 'any' })).toBe(
      '3:min7:any',
    )
  })

  it('prefixes scale keys and round-trips them', () => {
    const combo: ScaleCombo = {
      kind: 'scale',
      root: 3,
      scaleTypeId: 'harmonic-minor',
      shapeId: 'updown-2',
    }
    expect(comboKey(combo)).toBe('s:3:harmonic-minor:updown-2')
    expect(parseComboKey(comboKey(combo))).toEqual(combo)
  })

  it('parses stale or malformed scale keys to null', () => {
    expect(parseComboKey('s:0:dorian:up-1')).toBeNull() // removed type
    expect(parseComboKey('s:0:major:up-4')).toBeNull() // removed shape
    expect(parseComboKey('s:12:major:up-1')).toBeNull()
    expect(parseComboKey('s:0:major')).toBeNull()
    expect(parseComboKey('s:0:major:up-1:x')).toBeNull()
  })
})

describe('comboKeySide (§8)', () => {
  it('reads the side off the key', () => {
    expect(comboKeySide('0:maj:any')).toBe('chords')
    expect(comboKeySide('s:0:major:up-1')).toBe('scales')
    expect(comboKeySide('s:0:blues:up-9')).toBe('scales') // stale still counts
  })

  it('reads the side off a combo', () => {
    expect(comboSide({ root: 0, typeId: 'maj', voicingId: 'any' })).toBe(
      'chords',
    )
    expect(
      comboSide({
        kind: 'scale',
        root: 0,
        scaleTypeId: 'major',
        shapeId: 'up-1',
      }),
    ).toBe('scales')
  })
})
