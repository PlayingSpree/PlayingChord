import { describe, expect, it } from 'vitest'
import { comboKey, type Combo } from './combos'
import {
  allComboRows,
  applyOutcome,
  comboGrade,
  comboMetrics,
  comboScore,
  COMBO_GRADE_ORDER,
  displayGrade,
  FAST_TIME_MS,
  GRADE_EVIDENCE_FLOOR,
  gradeRank,
  IMPROVED_MIN_ATTEMPTS,
  InMemoryComboStats,
  isPassingGrade,
  MAX_TIME_TO_CORRECT_MS,
  NO_HISTORY,
  PASS_MIN_GRADE,
  rankMostImproved,
  rankWorstCombos,
  recentHistoryOf,
  RECENT_OUTCOME_WINDOW,
  RECENT_TIME_WINDOW,
  SLOW_TIME_MS,
  TIME_TO_CORRECT_SAMPLE_CAP,
  worstChordDisplayGrade,
  worstChordGrade,
  type ComboStatRecord,
} from './stats'

// Build a record of N first-try successes at the given time-to-correct.
const cleanRecord = (n: number, timeMs: number): ComboStatRecord => {
  let record: ComboStatRecord | null = null
  for (let i = 0; i < n; i++) record = applyOutcome(record, 'first-try', timeMs)
  return record!
}

describe('worstChordGrade (§7.1 In play)', () => {
  it('is null with no history', () => {
    expect(worstChordGrade([])).toBeNull()
  })

  it('takes the lowest-scoring combo grade, not the average', () => {
    const strong = cleanRecord(5, 500) // fast, clean → S
    const weakRecord = applyOutcome(
      applyOutcome(cleanRecord(3, 500), 'missed', 4000),
      'missed',
      4000,
    ) // several recent misses → low grade
    expect(comboGrade(comboMetrics(strong).score)).toBe('S')
    // The chord's grade is the weaker of the two, matching the weak combo.
    expect(worstChordGrade([strong, weakRecord])).toBe(
      comboGrade(comboMetrics(weakRecord).score),
    )
  })
})

describe('the evidence floor (§5, §7.5)', () => {
  const scoreAfter = (cleanReps: number) =>
    comboScore(recentHistoryOf(cleanRecord(cleanReps, 2500)))

  it('divides by the floor until the window fills that far', () => {
    // ~2.5s is 0.7 on the speed ramp, so these are accuracy × 0.7. The reps
    // not yet played count as misses: one clean rep is 1/5, not 1/1.
    expect(scoreAfter(1)).toBeCloseTo(0.2 * 0.7)
    expect(scoreAfter(2)).toBeCloseTo(0.4 * 0.7)
    expect(scoreAfter(GRADE_EVIDENCE_FLOOR)).toBeCloseTo(0.7)
    // Past the floor the divisor is the real count again, so the floor can
    // never hold a proven combo down.
    expect(scoreAfter(GRADE_EVIDENCE_FLOOR + 3)).toBeCloseTo(0.7)
  })

  it('keeps a lone lucky rep off the top of the scale', () => {
    // One flawless rep inside S's second used to grade S — and pass the chord
    // (§5.1) on that single rep.
    expect(comboGrade(comboScore(recentHistoryOf(cleanRecord(1, 500))))).toBe(
      'D',
    )
    expect(
      comboGrade(
        comboScore(recentHistoryOf(cleanRecord(GRADE_EVIDENCE_FLOOR, 500))),
      ),
    ).toBe('S')
  })

  it('leaves every already-proven record untouched', () => {
    // The floor is the old window, so nothing persisted before it existed
    // changes grade: a full window of 5 divides by 5 either way.
    const proven = cleanRecord(GRADE_EVIDENCE_FLOOR, 2000)
    expect(comboMetrics(proven).score).toBeCloseTo(0.8)
    expect(comboMetrics(proven).grade).toBe('A')
  })

  it('cannot pass a chord that has only ever been missed (§5.1)', () => {
    const missedOnce = applyOutcome(null, 'missed', 3000)
    expect(comboMetrics(missedOnce).grade).toBe('F')
    expect(isPassingGrade(worstChordGrade([missedOnce]))).toBe(false)
  })
})

describe('displayGrade / worstChordDisplayGrade (§7.5 `new`)', () => {
  const missedRecord = (n: number): ComboStatRecord => {
    let record: ComboStatRecord | null = null
    for (let i = 0; i < n; i++) record = applyOutcome(record, 'missed', 3000)
    return record!
  }

  it('shows `new` for an F the combo has not had the reps to disprove', () => {
    expect(displayGrade(missedRecord(1))).toBe('new')
    expect(displayGrade(missedRecord(GRADE_EVIDENCE_FLOOR - 1))).toBe('new')
  })

  it('shows the F once the window reaches the floor', () => {
    expect(displayGrade(missedRecord(GRADE_EVIDENCE_FLOOR))).toBe('F')
  })

  it('shows a below-floor letter as itself — passing is its own proof', () => {
    // Two clean reps grade D and pass the chord, so the badge has to say D:
    // a `new` beside the ★ learned pill would contradict it.
    expect(displayGrade(cleanRecord(2, 2500))).toBe('D')
  })

  it('folds a chord to `new` only when nothing proven is failing', () => {
    const unprovenF = missedRecord(1)
    const provenF = missedRecord(GRADE_EVIDENCE_FLOOR)
    const passing = cleanRecord(GRADE_EVIDENCE_FLOOR, 2000)

    expect(worstChordDisplayGrade([unprovenF])).toBe('new')
    // A proven F drags the chord red however many unproven combos sit beside it.
    expect(worstChordDisplayGrade([unprovenF, provenF])).toBe('F')
    // An unproven F still outranks a passing combo — the chord isn't passed,
    // it just has nothing to show yet.
    expect(worstChordDisplayGrade([unprovenF, passing])).toBe('new')
    expect(worstChordDisplayGrade([passing])).toBe('A')
    expect(worstChordDisplayGrade([])).toBeNull()
  })
})

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
    expect(comboScore({ misses: 2, total: 8, avgTimeToCorrectMs: null })).toBe(
      0.75,
    )
  })

  it('grades a flawless window on round seconds (§7.5)', () => {
    const gradeAt = (avgTimeToCorrectMs: number) =>
      comboGrade(
        comboScore({
          misses: 0,
          total: RECENT_OUTCOME_WINDOW,
          avgTimeToCorrectMs,
        }),
      )
    // The point of the ramp: each letter ends exactly on its own second.
    expect([1000, 2000, 3000, 4000, 5000].map(gradeAt)).toEqual([
      'S',
      'A',
      'B',
      'C',
      'D',
    ])
    expect([1001, 2001, 3001, 4001, 5001].map(gradeAt)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'F',
    ])
    // Under S's second is full credit, never a bonus — so a well-drilled combo
    // sits at the same score as an untouched one and §5 doesn't over-drill it.
    expect(comboScore({ misses: 0, total: 5, avgTimeToCorrectMs: 400 })).toBe(1)
    expect(comboScore({ misses: 0, total: 5, avgTimeToCorrectMs: 1000 })).toBe(
      1,
    )
  })

  it('bottoms out at zero on the §6.2 recording ceiling', () => {
    expect(
      comboScore({
        misses: 0,
        total: 5,
        avgTimeToCorrectMs: MAX_TIME_TO_CORRECT_MS,
      }),
    ).toBe(0)
  })

  it('scales speed multiplicatively with accuracy', () => {
    const score = comboScore({
      misses: 2,
      total: 8, // 75% accuracy
      avgTimeToCorrectMs: 2000, // 0.8 on the speed ramp (A's second)
    })
    expect(score).toBeCloseTo(0.75 * 0.8)
  })

  it('lets accuracy alone cap the letter, however fast the answers', () => {
    const gradeAtAccuracy = (misses: number) =>
      comboGrade(
        comboScore({
          misses,
          total: RECENT_OUTCOME_WINDOW,
          avgTimeToCorrectMs: 0, // as fast as it gets
        }),
      )
    // Two misses cost exactly one letter over a window of ten, so the cut
    // points still land on buckets and no single rep flips a grade.
    expect([0, 2, 4, 6, 8, 10].map(gradeAtAccuracy)).toEqual([
      'S',
      'A',
      'B',
      'C',
      'D',
      'F',
    ])
    // A lone miss can't take the top of the scale, however fast.
    expect(gradeAtAccuracy(1)).toBe('A')
  })

  it('a miss floors the score at 0 regardless of speed', () => {
    expect(comboScore({ misses: 5, total: 5, avgTimeToCorrectMs: 1 })).toBe(0)
  })

  it('grades bucket the score into letter tiers', () => {
    expect(comboGrade(1)).toBe('S') // S is the top of the scale, nothing less
    expect(comboGrade(0.9)).toBe('A')
    expect(comboGrade(0.8)).toBe('A')
    expect(comboGrade(0.6)).toBe('B')
    expect(comboGrade(0.4)).toBe('C')
    expect(comboGrade(0.2)).toBe('D')
    expect(comboGrade(0.1)).toBe('F')
    expect(comboGrade(0)).toBe('F')
  })

  it('puts the §7.3 slow bar exactly on the D/F speed boundary', () => {
    const gradeAt = (avgTimeToCorrectMs: number) =>
      comboGrade(comboScore({ misses: 0, total: 5, avgTimeToCorrectMs }))
    // A window of flawless reps at the bar still holds D; past it, F on speed
    // alone — which is precisely when a single such rep earns the chip.
    expect(gradeAt(SLOW_TIME_MS)).toBe('D')
    expect(gradeAt(SLOW_TIME_MS + 1)).toBe('F')
  })

  it('puts the §7.3 fast bar exactly on the A speed boundary', () => {
    const gradeAt = (avgTimeToCorrectMs: number) =>
      comboGrade(comboScore({ misses: 0, total: 5, avgTimeToCorrectMs }))
    // At the bar a flawless window grades A; a hair past it drops to B — so the
    // chip marks the reps that hold an A on speed alone.
    expect(gradeAt(FAST_TIME_MS)).toBe('A')
    expect(gradeAt(FAST_TIME_MS + 1)).toBe('B')
  })

  it('passes every grade but F (§5.1)', () => {
    expect(PASS_MIN_GRADE).toBe('D')
    for (const grade of COMBO_GRADE_ORDER) {
      expect(isPassingGrade(grade)).toBe(grade !== 'F')
    }
    // No history at all is not a pass — an attempt has just ruled that out.
    expect(isPassingGrade(null)).toBe(false)
  })

  it('ranks grades worst to best (§7.3 grade-up notice)', () => {
    expect(COMBO_GRADE_ORDER).toEqual(['F', 'D', 'C', 'B', 'A', 'S'])
    expect(gradeRank('F')).toBe(0)
    expect(gradeRank('S')).toBe(COMBO_GRADE_ORDER.length - 1)
    // What the toast asks: did the letter climb?
    expect(gradeRank('B') > gradeRank('C')).toBe(true)
    expect(gradeRank('D') > gradeRank('C')).toBe(false)
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
    expect(metrics.lifetimeAccuracy).toBeCloseTo(
      RECENT_OUTCOME_WINDOW / (3 + RECENT_OUTCOME_WINDOW),
    )
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
    // No time data → pure accuracy score. One of two landed, and the three
    // reps still owed to the evidence floor count as misses: 1/5.
    expect(metrics.score).toBe(0.2)
    expect(metrics.grade).toBe('D')
    // The accuracy *column* stays honest about the reps actually played.
    expect(metrics.recentAccuracy).toBe(0.5)
  })

  it('folds recent accuracy and recent speed into a score and grade', () => {
    let record: ComboStatRecord | null = null
    for (let i = 0; i < GRADE_EVIDENCE_FLOOR; i++) {
      record = applyOutcome(record, 'first-try', 1000)
    }
    const metrics = comboMetrics(record!)
    expect(metrics.score).toBe(1) // clean, and right on S's second
    expect(metrics.grade).toBe('S')
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
