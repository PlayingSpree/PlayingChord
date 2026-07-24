import { describe, expect, it } from 'vitest'
import {
  buildSessionReport,
  trailingBaseline,
  type DailyStatsForBaseline,
  type SessionReportInput,
} from './report'
import { comboGrade, sessionScore } from './stats'
import type { SessionEvent } from './session'

const day = (
  prompts: number,
  firstTrySuccesses: number,
  timeToCorrectMs: number,
): DailyStatsForBaseline => ({ prompts, firstTrySuccesses, timeToCorrectMs })

describe('trailingBaseline (§7.4)', () => {
  it('is null when no qualifying day exists', () => {
    expect(trailingBaseline({}, '2026-07-24')).toEqual({
      accuracy: null,
      avgTimeMs: null,
    })
  })

  it('averages per-day accuracy and avg-time, excluding today and empty days', () => {
    const baseline = trailingBaseline(
      {
        '2026-07-20': day(10, 8, 15_000), // 80%, 1500 ms
        '2026-07-21': day(0, 0, 0), // no prompts → excluded
        '2026-07-22': day(4, 2, 12_000), // 50%, 3000 ms
        '2026-07-24': day(2, 2, 1_000), // today → excluded
      },
      '2026-07-24',
    )
    expect(baseline.accuracy).toBeCloseTo((0.8 + 0.5) / 2, 6)
    expect(baseline.avgTimeMs).toBeCloseTo((1500 + 3000) / 2, 6)
  })

  it('windows to the most recent N practiced days', () => {
    const records: Record<string, DailyStatsForBaseline> = {}
    // 5 older days at 100% and one recent day at 0%; a 1-day window sees only
    // the recent day.
    for (let d = 10; d <= 14; d++) {
      records[`2026-07-${d}`] = day(1, 1, 1_000)
    }
    records['2026-07-20'] = day(1, 0, 5_000)
    const baseline = trailingBaseline(records, '2026-07-24', 1)
    expect(baseline.accuracy).toBe(0) // only the most recent day
    expect(baseline.avgTimeMs).toBe(5_000)
  })
})

const timed = (
  key: string,
  outcome: SessionEvent['outcome'],
  timeToCorrectMs: number,
): SessionEvent => ({ key, label: key, outcome, timeToCorrectMs })

const bar = (key: string, outcome: SessionEvent['outcome']): SessionEvent => ({
  key,
  label: key,
  outcome,
  timeToCorrectMs: null,
})

function input(
  overrides: Partial<SessionReportInput> = {},
): SessionReportInput {
  return {
    mode: 'practice',
    promptsPlayed: 0,
    events: [],
    records: {},
    todayKey: '2026-07-24',
    lifetime: { prompts: 0, activeMinutes: 0 },
    increment: { prompts: 0, activeMinutes: 0 },
    passedLabels: [],
    unlocked: null,
    goal: { todayMinutes: 0, streak: 0 },
    ...overrides,
  }
}

describe('buildSessionReport (§7.4)', () => {
  it('grades a Practice session with the same math as a chord grade', () => {
    const events = [
      timed('a', 'first-try', 1000),
      timed('a', 'first-try', 1000),
      timed('a', 'first-try', 1000),
      timed('a', 'first-try', 1000),
      timed('b', 'missed', 3000),
    ]
    const report = buildSessionReport(input({ events, promptsPlayed: 5 }))
    expect(report.recordedPrompts).toBe(5)
    expect(report.accuracy).toBeCloseTo(0.8, 6)
    expect(report.avgTimeMs).toBeCloseTo(1400, 6)
    // Grade parity: same accuracy + avg through the §5 score → same letter.
    expect(report.grade).toBe(comboGrade(sessionScore(0.8, 1400)))
  })

  it('gives a Song session full speed credit (no time samples)', () => {
    const events = [
      bar('a', 'first-try'),
      bar('a', 'first-try'),
      bar('b', 'missed'),
    ]
    const report = buildSessionReport(input({ mode: 'song', events }))
    expect(report.avgTimeMs).toBeNull()
    const accuracy = 2 / 3
    expect(report.grade).toBe(comboGrade(sessionScore(accuracy, null)))
  })

  it('never grades a Learn session (stats-neutral)', () => {
    const report = buildSessionReport(
      input({ mode: 'learn', promptsPlayed: 8 }),
    )
    expect(report.grade).toBeNull()
    expect(report.accuracy).toBeNull()
    expect(report.promptsPlayed).toBe(8)
  })

  it('has no accuracy or grade when nothing was recorded (all skips)', () => {
    const report = buildSessionReport(input({ promptsPlayed: 5, events: [] }))
    expect(report.accuracy).toBeNull()
    expect(report.grade).toBeNull()
    expect(report.promptsPlayed).toBe(5)
  })

  it('lists still-shaky chords, most misses first', () => {
    const events = [
      timed('C', 'missed', 3000),
      timed('C', 'missed', 3000),
      timed('D', 'missed', 3000),
      timed('E', 'first-try', 1000),
    ]
    const report = buildSessionReport(input({ events }))
    expect(report.shaky).toEqual([
      { label: 'C', misses: 2 },
      { label: 'D', misses: 1 },
    ])
  })

  it('passes through lifetime, increment, passed and unlock data', () => {
    const report = buildSessionReport(
      input({
        events: [timed('a', 'first-try', 1000)],
        lifetime: { prompts: 400, activeMinutes: 200 },
        increment: { prompts: 1, activeMinutes: 2.5 },
        passedLabels: ['C maj7'],
        unlocked: { labels: ['B♭ maj7'], unlocked: 7, passed: 5, total: 36 },
      }),
    )
    expect(report.lifetime).toEqual({ prompts: 400, activeMinutes: 200 })
    expect(report.increment).toEqual({ prompts: 1, activeMinutes: 2.5 })
    expect(report.passedLabels).toEqual(['C maj7'])
    expect(report.unlocked?.labels).toEqual(['B♭ maj7'])
  })
})
