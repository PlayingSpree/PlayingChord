import { describe, expect, it } from 'vitest'
import { comboKey, MAJOR_TRIADS_COMBOS, type Combo } from './combos'
import { pickCombo, RECENT_WINDOW } from './generator'

function poolOf(size: number): Combo[] {
  return MAJOR_TRIADS_COMBOS.slice(0, size).map((c) => ({ ...c }))
}

// Deterministic rng cycling through the given values.
function fixedRng(...values: number[]) {
  let i = 0
  return () => {
    const v = values[i % values.length]
    i++
    return v ?? 0
  }
}

describe('pickCombo — no immediate repeat (§5)', () => {
  it('never picks any of the last 3 combos in a large pool', () => {
    const pool = poolOf(12)
    const recent: string[] = []
    for (let i = 0; i < 500; i++) {
      const picked = pickCombo(pool, recent)
      expect(recent.slice(-RECENT_WINDOW)).not.toContain(comboKey(picked))
      recent.push(comboKey(picked))
    }
  })

  it('a 1-combo pool always generates (excludes nothing)', () => {
    const pool = poolOf(1)
    const only = pool[0]!
    const recent = [comboKey(only)]
    expect(pickCombo(pool, recent)).toEqual(only)
  })

  it('a 2-combo pool alternates (excludes only the last pick)', () => {
    const pool = poolOf(2)
    let last = pickCombo(pool, [])
    const recent = [comboKey(last)]
    for (let i = 0; i < 10; i++) {
      const next = pickCombo(pool, recent)
      expect(comboKey(next)).not.toBe(comboKey(last))
      recent.push(comboKey(next))
      last = next
    }
  })

  it('a 3-combo pool excludes the last 2, so the pick is forced', () => {
    const pool = poolOf(3)
    const recent = [comboKey(pool[0]!), comboKey(pool[1]!)]
    // Whatever the rng says, only pool[2] remains.
    expect(pickCombo(pool, recent, fixedRng(0))).toEqual(pool[2])
    expect(pickCombo(pool, recent, fixedRng(0.99))).toEqual(pool[2])
  })

  it('only the tail of a long history is excluded', () => {
    const pool = poolOf(12)
    // Every combo appears in history; only the last 3 must be excluded.
    const recent = pool.map(comboKey)
    const picked = pickCombo(pool, recent)
    expect(recent.slice(-RECENT_WINDOW)).not.toContain(comboKey(picked))
  })
})

describe('pickCombo — uniform selection', () => {
  it('is deterministic for a fixed rng', () => {
    const pool = poolOf(12)
    const a = pickCombo(pool, [], fixedRng(0.5))
    const b = pickCombo(pool, [], fixedRng(0.5))
    expect(a).toEqual(b)
  })

  it('rng of ~1 stays in range', () => {
    const pool = poolOf(12)
    expect(pool).toContainEqual(pickCombo(pool, [], () => 0.999999))
  })

  it('reaches every non-excluded combo', () => {
    const pool = poolOf(4)
    const recent = [comboKey(pool[3]!)]
    const seen = new Set<string>()
    for (let i = 0; i < 200; i++) {
      seen.add(comboKey(pickCombo(pool, recent)))
    }
    expect([...seen].sort()).toEqual(pool.slice(0, 3).map(comboKey).sort())
  })

  it('throws on an empty pool', () => {
    expect(() => pickCombo([], [])).toThrow()
  })
})
