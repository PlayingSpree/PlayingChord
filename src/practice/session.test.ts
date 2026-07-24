import { describe, expect, it } from 'vitest'
import {
  sanitizeSessionLength,
  summarizeSession,
  type SessionEvent,
} from './session'

const event = (
  key: string,
  outcome: SessionEvent['outcome'],
  timeToCorrectMs: number | null,
): SessionEvent => ({ key, label: key, outcome, timeToCorrectMs })

describe('summarizeSession (§7 end-of-session summary)', () => {
  it('summarizes an empty session', () => {
    expect(summarizeSession([])).toEqual({
      prompts: 0,
      firstTrySuccesses: 0,
      totalTimeToCorrectMs: 0,
      avgTimeToCorrectMs: null,
      bestAvgTimeToCorrectMs: null,
      slowest: [],
      worst: [],
    })
  })

  it('tallies prompts, first-try successes and total/avg time', () => {
    const summary = summarizeSession([
      event('a', 'first-try', 1000),
      event('a', 'missed', 3000),
      event('b', 'first-try', 2000),
    ])
    expect(summary.prompts).toBe(3)
    expect(summary.firstTrySuccesses).toBe(2)
    expect(summary.totalTimeToCorrectMs).toBe(6000)
    expect(summary.avgTimeToCorrectMs).toBe(2000)
  })

  it('ranks slowest by average time-to-correct, worst by accuracy', () => {
    const summary = summarizeSession([
      event('fast-clean', 'first-try', 500),
      event('fast-clean', 'first-try', 700),
      event('slow-clean', 'first-try', 4000),
      event('missed-once', 'missed', 2000),
      event('missed-once', 'first-try', 1000),
      event('missed-always', 'missed', 3000),
    ])

    expect(summary.slowest.map((e) => e.key)).toEqual([
      'slow-clean',
      'missed-always',
      'missed-once',
    ])
    expect(summary.slowest[0]).toMatchObject({
      prompts: 1,
      avgTimeToCorrectMs: 4000,
    })

    // Only chords with a miss qualify as "worst"; lower accuracy is worse.
    expect(summary.worst.map((e) => e.key)).toEqual([
      'missed-always',
      'missed-once',
    ])
    expect(summary.worst[1]?.accuracy).toBe(0.5)
  })

  it('picks best by per-chord average, not the single fastest raw sample', () => {
    const summary = summarizeSession([
      // One lucky rep (100ms) dragged down by a slow second rep — a fluke,
      // not a consistently fast chord.
      event('lucky', 'first-try', 100),
      event('lucky', 'first-try', 5000),
      // Consistently quick across both reps, never the single fastest.
      event('consistent', 'first-try', 1000),
      event('consistent', 'first-try', 1200),
    ])
    expect(summary.bestAvgTimeToCorrectMs).toBe(1100)
  })

  it('excludes Song bars (null time) from time stats but counts accuracy', () => {
    const summary = summarizeSession([
      event('song', 'first-try', null),
      event('song', 'missed', null),
      event('timed', 'first-try', 1500),
    ])
    // All three count as prompts and toward accuracy…
    expect(summary.prompts).toBe(3)
    expect(summary.firstTrySuccesses).toBe(2)
    // …but only the timed prompt feeds the time figures.
    expect(summary.totalTimeToCorrectMs).toBe(1500)
    expect(summary.avgTimeToCorrectMs).toBe(1500)
    expect(summary.bestAvgTimeToCorrectMs).toBe(1500)
    // A Song-only chord has no time to be "slow".
    expect(summary.slowest.map((e) => e.key)).toEqual(['timed'])
    // But it can still be "worst" on accuracy.
    expect(summary.worst.map((e) => e.key)).toEqual(['song'])
    expect(summary.worst[0]?.avgTimeToCorrectMs).toBeNull()
  })

  it('caps both lists at 3 entries', () => {
    const events = ['a', 'b', 'c', 'd', 'e'].map((k) => event(k, 'missed', 1))
    const summary = summarizeSession(events)
    expect(summary.slowest).toHaveLength(3)
    expect(summary.worst).toHaveLength(3)
  })
})

describe('sanitizeSessionLength (§7.2)', () => {
  it('keeps null as ∞', () => {
    expect(sanitizeSessionLength(null)).toBeNull()
  })

  it('rounds positive counts', () => {
    expect(sanitizeSessionLength(10)).toBe(10)
    expect(sanitizeSessionLength(20)).toBe(20)
    expect(sanitizeSessionLength(40.4)).toBe(40)
  })

  it('falls back to the default on junk', () => {
    expect(sanitizeSessionLength(0)).toBe(20)
    expect(sanitizeSessionLength(-5)).toBe(20)
    expect(sanitizeSessionLength(NaN)).toBe(20)
    expect(sanitizeSessionLength('10')).toBe(20)
  })
})
