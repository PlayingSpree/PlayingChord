import { describe, expect, it } from 'vitest'
import { InMemoryRecentStats, NO_HISTORY, RECENT_OUTCOME_WINDOW } from './stats'

describe('InMemoryRecentStats (§5 weighting stub)', () => {
  it('returns null for a combo with no history', () => {
    expect(new InMemoryRecentStats().recentHistory('0:maj:any')).toBeNull()
  })

  it('counts misses and totals per combo independently', () => {
    const stats = new InMemoryRecentStats()
    stats.record('a', 'missed')
    stats.record('a', 'first-try')
    stats.record('b', 'first-try')
    expect(stats.recentHistory('a')).toEqual({ misses: 1, total: 2 })
    expect(stats.recentHistory('b')).toEqual({ misses: 0, total: 1 })
  })

  it('only the most recent window of outcomes counts', () => {
    const stats = new InMemoryRecentStats()
    for (let i = 0; i < RECENT_OUTCOME_WINDOW; i++) stats.record('a', 'missed')
    expect(stats.recentHistory('a')).toEqual({
      misses: RECENT_OUTCOME_WINDOW,
      total: RECENT_OUTCOME_WINDOW,
    })

    // Successes push the old misses out one by one.
    for (let i = 0; i < RECENT_OUTCOME_WINDOW; i++) {
      stats.record('a', 'first-try')
    }
    expect(stats.recentHistory('a')).toEqual({
      misses: 0,
      total: RECENT_OUTCOME_WINDOW,
    })
  })

  it('NO_HISTORY reports null for everything', () => {
    expect(NO_HISTORY.recentHistory('anything')).toBeNull()
  })
})
