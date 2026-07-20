import { describe, expect, it } from 'vitest'
import { comboKey, type Combo } from './combos'
import { FAST_TIME_MS } from './progress'
import {
  allComboRows,
  applyOutcome,
  comboGrade,
  comboMetrics,
  comboScore,
  IMPROVED_MIN_ATTEMPTS,
  InMemoryComboStats,
  NO_HISTORY,
  rankMostImproved,
  rankWorstCombos,
  recentHistoryOf,
  RECENT_OUTCOME_WINDOW,
  RECENT_TIME_WINDOW,
  TIME_TO_CORRECT_SAMPLE_CAP,
  type ComboStatRecord,
} from './stats'

describe('applyOutcome (§8 combo stat record)', () => {
  it('creates a fresh record from null', () => {
    expect(applyOutcome(null, 'first-try', 1500)).toEqual({
      attempts: 1,
      firstTrySuccesses: 1,
      recentOutcomes: ['first-try'],
      timeToCorrectMs: [1500],
    })
  })

  it('counts attempts and first-try successes across outcomes', () => {
    let record = applyOutcome(null, 'missed', 4000)
    record = applyOutcome(record, 'first-try', 1000)
    record = applyOutcome(record, 'missed', 6000)
    expect(record.attempts).toBe(3)
    expect(record.firstTrySuccesses).toBe(1)
  })

  it('caps the recent-outcome window', () => {
    let record: ComboStatRecord | null = null
    for (let i = 0; i < RECENT_OUTCOME_WINDOW + 2; i++) {
      record = applyOutcome(record, 'missed', 1000)
    }
    expect(record!.recentOutcomes).toHaveLength(RECENT_OUTCOME_WINDOW)
    expect(record!.attempts).toBe(RECENT_OUTCOME_WINDOW + 2)
  })

  it('caps time-to-correct samples, keeping the newest', () => {
    let record: ComboStatRecord | null = null
    for (let i = 0; i < TIME_TO_CORRECT_SAMPLE_CAP + 3; i++) {
      record = applyOutcome(record, 'first-try', i)
    }
    expect(record!.timeToCorrectMs).toHaveLength(TIME_TO_CORRECT_SAMPLE_CAP)
    expect(record!.timeToCorrectMs[0]).toBe(3)
  })

  it('rounds and clamps time samples to non-negative integers', () => {
    const record = applyOutcome(
      applyOutcome(null, 'first-try', 1234.6),
      'first-try',
      -50,
    )
    expect(record.timeToCorrectMs).toEqual([1235, 0])
  })

  it('a null time (§6.5 Song bar) counts the outcome without a sample', () => {
    let record = applyOutcome(null, 'first-try', null)
    record = applyOutcome(record, 'missed', null)
    record = applyOutcome(record, 'first-try', 1200)
    expect(record.attempts).toBe(3)
    expect(record.firstTrySuccesses).toBe(2)
    expect(record.recentOutcomes).toEqual(['first-try', 'missed', 'first-try'])
    expect(record.timeToCorrectMs).toEqual([1200])
  })
})

describe('recentHistoryOf / InMemoryComboStats (§5 weighting view)', () => {
  it('returns null for a combo with no history', () => {
    expect(new InMemoryComboStats().recentHistory('0:maj:any')).toBeNull()
    expect(new InMemoryComboStats().get('0:maj:any')).toBeNull()
    expect(recentHistoryOf(null)).toBeNull()
  })

  it('counts misses and totals per combo independently', () => {
    const stats = new InMemoryComboStats()
    stats.record('a', 'missed', 3000)
    stats.record('a', 'first-try', 1000)
    stats.record('b', 'first-try', 900)
    expect(stats.recentHistory('a')).toEqual({
      misses: 1,
      total: 2,
      avgTimeToCorrectMs: 2000,
    })
    expect(stats.recentHistory('b')).toEqual({
      misses: 0,
      total: 1,
      avgTimeToCorrectMs: 900,
    })
  })

  it('only the most recent window of outcomes counts', () => {
    const stats = new InMemoryComboStats()
    for (let i = 0; i < RECENT_OUTCOME_WINDOW; i++) {
      stats.record('a', 'missed', 1000)
    }
    expect(stats.recentHistory('a')).toEqual({
      misses: RECENT_OUTCOME_WINDOW,
      total: RECENT_OUTCOME_WINDOW,
      avgTimeToCorrectMs: 1000,
    })

    // Successes push the old misses out one by one.
    for (let i = 0; i < RECENT_OUTCOME_WINDOW; i++) {
      stats.record('a', 'first-try', 1000)
    }
    expect(stats.recentHistory('a')).toEqual({
      misses: 0,
      total: RECENT_OUTCOME_WINDOW,
      avgTimeToCorrectMs: 1000,
    })
  })

  it('NO_HISTORY reports null for everything', () => {
    expect(NO_HISTORY.recentHistory('anything')).toBeNull()
  })
})

describe('comboScore / comboGrade (§5 prioritization, §7 chord stats grade)', () => {
  it('no history, or an empty window, scores at the uniform baseline', () => {
    expect(comboScore(null)).toBe(1)
    expect(comboScore({ misses: 0, total: 0, avgTimeToCorrectMs: null })).toBe(
      1,
    )
  })

  it('is pure recent accuracy when there is no time data', () => {
    expect(comboScore({ misses: 1, total: 4, avgTimeToCorrectMs: null })).toBe(
      0.75,
    )
  })

  it('gives full speed credit at or under the mastery bar', () => {
    expect(
      comboScore({ misses: 0, total: 5, avgTimeToCorrectMs: FAST_TIME_MS }),
    ).toBe(1)
    expect(
      comboScore({
        misses: 0,
        total: 5,
        avgTimeToCorrectMs: FAST_TIME_MS / 2,
      }),
    ).toBe(1) // faster than the bar caps at full credit, never a bonus
  })

  it('decays past the mastery bar, multiplicatively with accuracy', () => {
    const score = comboScore({
      misses: 1,
      total: 4, // 75% accuracy
      avgTimeToCorrectMs: FAST_TIME_MS * 2, // half credit on speed
    })
    expect(score).toBeCloseTo(0.75 * 0.5)
  })

  it('a miss floors the score at 0 regardless of speed', () => {
    expect(comboScore({ misses: 5, total: 5, avgTimeToCorrectMs: 1 })).toBe(0)
  })

  it('grades bucket the score into letter tiers', () => {
    expect(comboGrade(1)).toBe('A')
    expect(comboGrade(0.9)).toBe('A')
    expect(comboGrade(0.8)).toBe('B')
    expect(comboGrade(0.6)).toBe('C')
    expect(comboGrade(0.4)).toBe('D')
    expect(comboGrade(0.1)).toBe('F')
    expect(comboGrade(0)).toBe('F')
  })
})

describe('rankWorstCombos (§7 worst chords)', () => {
  const combo = (root: number): Combo => ({
    root: root as Combo['root'],
    typeId: 'maj',
    voicingId: 'any',
  })
  const key = (root: number) => `${root}:maj:any`
  const pool = [combo(0), combo(1), combo(2), combo(3)]

  it('excludes unpracticed and never-missed combos', () => {
    const stats = new InMemoryComboStats()
    stats.record(key(0), 'first-try', 1000) // clean — not "worst"
    stats.record(key(1), 'missed', 5000)
    expect(rankWorstCombos(pool, stats).map((w) => w.combo.root)).toEqual([1])
  })

  it('ranks by recent-miss rate first', () => {
    const stats = new InMemoryComboStats()
    stats.record(key(1), 'missed', 5000)
    stats.record(key(1), 'first-try', 1000)
    stats.record(key(2), 'missed', 5000)
    stats.record(key(2), 'missed', 5000)
    expect(rankWorstCombos(pool, stats).map((w) => w.combo.root)).toEqual([
      2, 1,
    ])
  })

  it('breaks recent ties by lifetime miss rate', () => {
    const stats = new InMemoryComboStats()
    // Both clean in the recent window after enough successes, but combo 1
    // carries old misses in its lifetime record.
    stats.record(key(1), 'missed', 5000)
    for (let i = 0; i < RECENT_OUTCOME_WINDOW; i++) {
      stats.record(key(1), 'first-try', 1000)
      stats.record(key(2), 'first-try', 1000)
    }
    stats.record(key(2), 'missed', 5000) // 1 recent miss beats lifetime-only
    const ranked = rankWorstCombos(pool, stats)
    expect(ranked.map((w) => w.combo.root)).toEqual([2, 1])
  })

  it('honors the limit', () => {
    const stats = new InMemoryComboStats()
    for (const c of pool) stats.record(key(c.root), 'missed', 5000)
    expect(rankWorstCombos(pool, stats, 2)).toHaveLength(2)
  })

  it('only considers combos in the given pool', () => {
    const stats = new InMemoryComboStats()
    stats.record('9:min7:any', 'missed', 5000)
    expect(rankWorstCombos(pool, stats)).toEqual([])
  })
})

describe('rankMostImproved (§7 History)', () => {
  const combo = (root: number): Combo => ({
    root: root as Combo['root'],
    typeId: 'maj',
    voicingId: 'any',
  })
  const key = (root: number) => `${root}:maj:any`
  const pool = [combo(0), combo(1), combo(2)]

  // Miss-heavy past, then a full recent window with the given misses.
  const seed = (
    stats: InMemoryComboStats,
    root: number,
    recentMisses: number,
  ) => {
    for (let i = 0; i < IMPROVED_MIN_ATTEMPTS; i++) {
      stats.record(key(root), 'missed', 5000)
    }
    for (let i = 0; i < RECENT_OUTCOME_WINDOW; i++) {
      const missed = i < recentMisses
      stats.record(key(root), missed ? 'missed' : 'first-try', 1000)
    }
  }

  it('ranks combos whose recent window beats their lifetime miss rate', () => {
    const stats = new InMemoryComboStats()
    seed(stats, 0, 0) // fully clean now — most improved
    seed(stats, 1, 2) // partly improved
    seed(stats, 2, RECENT_OUTCOME_WINDOW) // still missing everything
    const ranked = rankMostImproved(pool, stats)
    expect(ranked.map((r) => r.combo.root)).toEqual([0, 1])
    expect(ranked[0]!.improvement).toBeGreaterThan(ranked[1]!.improvement)
  })

  it('needs enough attempts and a full recent window', () => {
    const stats = new InMemoryComboStats()
    // 3 attempts: a lucky short history is not a trend.
    stats.record(key(0), 'missed', 5000)
    stats.record(key(0), 'first-try', 1000)
    stats.record(key(0), 'first-try', 1000)
    expect(rankMostImproved(pool, stats)).toEqual([])
  })

  it('never ranks clean or unpracticed combos', () => {
    const stats = new InMemoryComboStats()
    for (let i = 0; i < IMPROVED_MIN_ATTEMPTS + RECENT_OUTCOME_WINDOW; i++) {
      stats.record(key(0), 'first-try', 1000) // clean: nothing to improve on
    }
    expect(rankMostImproved(pool, stats)).toEqual([])
  })
})

describe('comboMetrics (§7 chord stats page)', () => {
  it('computes lifetime and recent accuracy separately', () => {
    let record: ComboStatRecord | null = null
    for (let i = 0; i < 3; i++) record = applyOutcome(record, 'missed', 5000)
    for (let i = 0; i < RECENT_OUTCOME_WINDOW; i++) {
      record = applyOutcome(record, 'first-try', 1000)
    }
    const metrics = comboMetrics(record!)
    expect(metrics.attempts).toBe(3 + RECENT_OUTCOME_WINDOW)
    expect(metrics.lifetimeAccuracy).toBeCloseTo(5 / 8)
    expect(metrics.recentAccuracy).toBe(1) // old misses fell out of the window
  })

  it('windows the recent average separately from the lifetime average', () => {
    let record: ComboStatRecord | null = null
    for (let i = 0; i < 3; i++) {
      record = applyOutcome(record, 'first-try', 5000)
    }
    for (let i = 0; i < RECENT_TIME_WINDOW; i++) {
      record = applyOutcome(record, 'first-try', 1000)
    }
    const metrics = comboMetrics(record!)
    expect(metrics.lifetimeAvgTimeToCorrectMs).toBeCloseTo(
      (3 * 5000 + RECENT_TIME_WINDOW * 1000) / (3 + RECENT_TIME_WINDOW),
    )
    expect(metrics.recentAvgTimeToCorrectMs).toBe(1000)
  })

  it('the recent average matches the lifetime average under the window size', () => {
    let record: ComboStatRecord | null = null
    for (const ms of [500, 700, 900]) {
      record = applyOutcome(record, 'first-try', ms)
    }
    const metrics = comboMetrics(record!)
    expect(metrics.recentAvgTimeToCorrectMs).toBe(
      metrics.lifetimeAvgTimeToCorrectMs,
    )
  })

  it('both time fields are null when every sample is a Song-mode bar', () => {
    let record: ComboStatRecord | null = applyOutcome(null, 'first-try', null)
    record = applyOutcome(record, 'missed', null)
    const metrics = comboMetrics(record!)
    expect(metrics.attempts).toBe(2)
    expect(metrics.lifetimeAvgTimeToCorrectMs).toBeNull()
    expect(metrics.recentAvgTimeToCorrectMs).toBeNull()
    // No time data → pure accuracy score (1 of 2 recent outcomes missed).
    expect(metrics.score).toBe(0.5)
    expect(metrics.grade).toBe('D')
  })

  it('folds recent accuracy and recent speed into a score and grade', () => {
    let record: ComboStatRecord | null = null
    for (let i = 0; i < 4; i++) {
      record = applyOutcome(record, 'first-try', FAST_TIME_MS)
    }
    const metrics = comboMetrics(record!)
    expect(metrics.score).toBe(1)
    expect(metrics.grade).toBe('A')
  })
})

describe('allComboRows (§7 chord stats page)', () => {
  const combo = (root: number): Combo => ({
    root: root as Combo['root'],
    typeId: 'maj',
    voicingId: 'any',
  })

  it('resolves persisted keys back into combos', () => {
    const record = applyOutcome(null, 'first-try', 1000)
    const rows = allComboRows({ [comboKey(combo(0))]: record })
    expect(rows).toEqual([{ key: comboKey(combo(0)), combo: combo(0), record }])
  })

  it('drops keys that no longer resolve (removed type / deleted custom rule)', () => {
    const record = applyOutcome(null, 'first-try', 1000)
    const rows = allComboRows({
      '0:not-a-real-type:any': record,
      [comboKey(combo(1))]: record,
    })
    expect(rows.map((r) => r.key)).toEqual([comboKey(combo(1))])
  })
})
