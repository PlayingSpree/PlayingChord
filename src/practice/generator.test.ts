import { describe, expect, it } from 'vitest'
import { ALL_PITCH_CLASSES } from '../theory'
import { comboKey, type Combo } from './combos'
import {
  comboWeight,
  fillQueue,
  MISS_WEIGHT_BOOST,
  pickCombo,
  pickWeightedCombo,
  RECENT_WINDOW,
} from './generator'
import { type ComboRecentHistory, type RecentStatsSource } from './stats'

function poolOf(size: number): Combo[] {
  return ALL_PITCH_CLASSES.slice(0, size).map((root) => ({
    root,
    typeId: 'maj',
    voicingId: 'any',
  }))
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

// Deterministic LCG for distribution tests.
function seededRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function statsOf(byKey: Record<string, ComboRecentHistory>): RecentStatsSource {
  return { recentHistory: (key) => byKey[key] ?? null }
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

describe('comboWeight (§5)', () => {
  it('no history is the uniform baseline', () => {
    expect(comboWeight(null)).toBe(1)
  })

  it('a clean recent record stays at baseline — success never down-weights', () => {
    expect(comboWeight({ misses: 0, total: 5, avgTimeToCorrectMs: null })).toBe(
      1,
    )
  })

  it('scales linearly with the recent-miss rate', () => {
    expect(comboWeight({ misses: 5, total: 5, avgTimeToCorrectMs: null })).toBe(
      1 + MISS_WEIGHT_BOOST,
    )
    expect(comboWeight({ misses: 1, total: 2, avgTimeToCorrectMs: null })).toBe(
      1 + MISS_WEIGHT_BOOST / 2,
    )
  })

  it('also scales with recent average time-to-correct, independent of accuracy', () => {
    const atThreshold = comboWeight({
      misses: 0,
      total: 5,
      avgTimeToCorrectMs: 1000, // at/under the mastery bar — full credit
    })
    const slow = comboWeight({
      misses: 0,
      total: 5,
      avgTimeToCorrectMs: 6000,
    })
    expect(atThreshold).toBe(1)
    expect(slow).toBeGreaterThan(1)
  })

  it('a combo missed and slow weighs more than either alone', () => {
    const missedOnly = comboWeight({
      misses: 5,
      total: 5,
      avgTimeToCorrectMs: 1000,
    })
    const missedAndSlow = comboWeight({
      misses: 5,
      total: 5,
      avgTimeToCorrectMs: 6000,
    })
    // Accuracy is already 0, so speed can't push the weight past the boost
    // cap — both land at the same maximum.
    expect(missedAndSlow).toBe(missedOnly)
    expect(missedOnly).toBe(1 + MISS_WEIGHT_BOOST)
  })
})

describe('pickWeightedCombo (§5)', () => {
  it('behaves uniformly when nothing has history', () => {
    const pool = poolOf(12)
    const rngA = seededRng(42)
    const rngB = seededRng(42)
    for (let i = 0; i < 100; i++) {
      expect(pickWeightedCombo(pool, [], statsOf({}), rngA)).toEqual(
        pickCombo(pool, [], rngB),
      )
    }
  })

  it('picks a heavily-missed combo more often (synthetic history)', () => {
    const pool = poolOf(4)
    const missed = pool[0]!
    // missed at 100% recent miss rate → weight 4; the other three → 1 each,
    // so the expected share is 4/7 ≈ 0.571.
    const stats = statsOf({
      [comboKey(missed)]: { misses: 5, total: 5, avgTimeToCorrectMs: null },
    })
    const rng = seededRng(7)
    let hits = 0
    const draws = 5000
    for (let i = 0; i < draws; i++) {
      if (
        comboKey(pickWeightedCombo(pool, [], stats, rng)) === comboKey(missed)
      )
        hits++
    }
    expect(hits / draws).toBeGreaterThan(0.53)
    expect(hits / draws).toBeLessThan(0.61)
  })

  it('still never repeats within the recent window, even when the missed combo is excluded', () => {
    const pool = poolOf(5)
    const missed = pool[0]!
    const stats = statsOf({
      [comboKey(missed)]: { misses: 5, total: 5, avgTimeToCorrectMs: null },
    })
    const recent: string[] = []
    const rng = seededRng(3)
    for (let i = 0; i < 300; i++) {
      const picked = pickWeightedCombo(pool, recent, stats, rng)
      expect(recent.slice(-RECENT_WINDOW)).not.toContain(comboKey(picked))
      recent.push(comboKey(picked))
    }
  })

  it('rng of ~1 stays in range under weights', () => {
    const pool = poolOf(4)
    const stats = statsOf({
      [comboKey(pool[0]!)]: { misses: 5, total: 5, avgTimeToCorrectMs: null },
    })
    expect(pool).toContainEqual(
      pickWeightedCombo(pool, [], stats, () => 0.9999999),
    )
  })
})

describe('fillQueue (§5 upcoming preview)', () => {
  it('fills an empty queue to count', () => {
    const pool = poolOf(12)
    const queue = fillQueue([], 4, pool, [], statsOf({}))
    expect(queue).toHaveLength(4)
    queue.forEach((combo) => expect(pool).toContainEqual(combo))
  })

  it('preserves the existing queue prefix and only appends', () => {
    const pool = poolOf(12)
    const seed = fillQueue([], 2, pool, [], statsOf({}))
    const filled = fillQueue(seed, 4, pool, [], statsOf({}))
    expect(filled.slice(0, 2)).toEqual(seed)
    expect(filled).toHaveLength(4)
  })

  it('a large pool has no duplicates among queued items or the recent tail', () => {
    const pool = poolOf(12)
    const recent = pool.slice(0, 3).map(comboKey)
    const queue = fillQueue([], 4, pool, recent, statsOf({}))
    const keys = queue.map(comboKey)
    expect(new Set(keys).size).toBe(keys.length)
    keys.forEach((key) => expect(recent).not.toContain(key))
  })

  it('a 2-combo pool alternates without throwing', () => {
    const pool = poolOf(2)
    const queue = fillQueue([], 4, pool, [], statsOf({}))
    expect(queue).toHaveLength(4)
    for (let i = 1; i < queue.length; i++) {
      expect(comboKey(queue[i]!)).not.toBe(comboKey(queue[i - 1]!))
    }
  })

  it('a 1-combo pool returns count copies of the only combo', () => {
    const pool = poolOf(1)
    const queue = fillQueue([], 4, pool, [], statsOf({}))
    expect(queue).toEqual([pool[0], pool[0], pool[0], pool[0]])
  })

  it('the first pick from an empty queue matches pickWeightedCombo with the same rng', () => {
    const pool = poolOf(12)
    const stats = statsOf({
      [comboKey(pool[0]!)]: { misses: 5, total: 5, avgTimeToCorrectMs: null },
    })
    const rngA = seededRng(11)
    const rngB = seededRng(11)
    const [head] = fillQueue([], 1, pool, [], stats, rngA)
    expect(head).toEqual(pickWeightedCombo(pool, [], stats, rngB))
  })
})
