import { describe, expect, it } from 'vitest'
import {
  computeBestStreak,
  computeStreak,
  lastDateKeys,
  meetsGoal,
  previousDateKey,
} from './goals'
import type { DailyRecord } from './schema'

const day = (date: string, activeMinutes: number): DailyRecord => ({
  date,
  activeMinutes,
  prompts: 0,
  firstTrySuccesses: 0,
  timeToCorrectMs: 0,
})

const records = (...days: DailyRecord[]): Record<string, DailyRecord> =>
  Object.fromEntries(days.map((d) => [d.date, d]))

describe('date-key arithmetic', () => {
  it('steps back across month and year boundaries', () => {
    expect(previousDateKey('2026-07-16')).toBe('2026-07-15')
    expect(previousDateKey('2026-07-01')).toBe('2026-06-30')
    expect(previousDateKey('2026-01-01')).toBe('2025-12-31')
    expect(previousDateKey('2024-03-01')).toBe('2024-02-29') // leap year
  })

  it('steps cleanly across DST transitions', () => {
    // 2026-03-08 (US spring-forward) and 2026-11-01 (fall-back): both are
    // 23/25-hour days in DST timezones; noon-based arithmetic must not skip
    // or repeat a day regardless of the machine's timezone.
    expect(previousDateKey('2026-03-09')).toBe('2026-03-08')
    expect(previousDateKey('2026-03-08')).toBe('2026-03-07')
    expect(previousDateKey('2026-11-02')).toBe('2026-11-01')
    expect(previousDateKey('2026-11-01')).toBe('2026-10-31')
  })

  it('lastDateKeys returns count keys ending today, oldest first', () => {
    expect(lastDateKeys('2026-07-16', 3)).toEqual([
      '2026-07-14',
      '2026-07-15',
      '2026-07-16',
    ])
    expect(lastDateKeys('2026-07-16', 1)).toEqual(['2026-07-16'])
  })
})

describe('meetsGoal', () => {
  it('compares active minutes against the goal', () => {
    expect(meetsGoal(day('2026-07-16', 10), 10)).toBe(true)
    expect(meetsGoal(day('2026-07-16', 9.99), 10)).toBe(false)
    expect(meetsGoal(undefined, 10)).toBe(false)
  })
})

describe('computeStreak (§7)', () => {
  it('is 0 with no qualifying days', () => {
    expect(computeStreak({}, 10, '2026-07-16')).toBe(0)
    expect(computeStreak(records(day('2026-07-16', 5)), 10, '2026-07-16')).toBe(
      0,
    )
  })

  it('counts consecutive goal-met days ending today', () => {
    const r = records(
      day('2026-07-14', 12),
      day('2026-07-15', 10),
      day('2026-07-16', 15),
    )
    expect(computeStreak(r, 10, '2026-07-16')).toBe(3)
  })

  it('an unmet today does not break yesterday-ending streaks', () => {
    const r = records(
      day('2026-07-14', 12),
      day('2026-07-15', 10),
      day('2026-07-16', 3), // today, goal not reached yet
    )
    expect(computeStreak(r, 10, '2026-07-16')).toBe(2)
    // …and once today crosses the goal, it joins the chain.
    r['2026-07-16'] = day('2026-07-16', 10)
    expect(computeStreak(r, 10, '2026-07-16')).toBe(3)
  })

  it('a gap day breaks the chain', () => {
    const r = records(
      day('2026-07-12', 20),
      day('2026-07-13', 20),
      // 14th missing entirely
      day('2026-07-15', 20),
      day('2026-07-16', 20),
    )
    expect(computeStreak(r, 10, '2026-07-16')).toBe(2)
  })

  it('is evaluated against the current goal, not a stored one', () => {
    const r = records(day('2026-07-15', 12), day('2026-07-16', 12))
    expect(computeStreak(r, 10, '2026-07-16')).toBe(2)
    expect(computeStreak(r, 15, '2026-07-16')).toBe(0)
  })

  it('counts across a DST transition', () => {
    const r = records(
      day('2026-03-07', 10),
      day('2026-03-08', 10), // spring-forward day
      day('2026-03-09', 10),
    )
    expect(computeStreak(r, 10, '2026-03-09')).toBe(3)
  })
})

describe('computeBestStreak (§7 History)', () => {
  it('finds the longest run anywhere in the records', () => {
    const r = records(
      day('2026-06-01', 10),
      day('2026-06-02', 10),
      day('2026-06-03', 10),
      // gap
      day('2026-07-15', 10),
      day('2026-07-16', 10),
    )
    expect(computeBestStreak(r, 10)).toBe(3)
    expect(computeBestStreak({}, 10)).toBe(0)
  })

  it('runs are broken by under-goal days', () => {
    const r = records(
      day('2026-07-13', 10),
      day('2026-07-14', 2),
      day('2026-07-15', 10),
      day('2026-07-16', 10),
    )
    expect(computeBestStreak(r, 10)).toBe(2)
  })
})
