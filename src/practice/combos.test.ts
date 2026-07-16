import { describe, expect, it } from 'vitest'
import { comboKey, parseComboKey, type Combo } from './combos'

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
})
