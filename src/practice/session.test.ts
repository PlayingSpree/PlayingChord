import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SESSION_LENGTH,
  sanitizeSessionLength,
  sessionLengthReached,
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
  })
})

describe('sanitizeSessionLength (§7.2)', () => {
  it('keeps null as ∞, in either unit', () => {
    expect(sanitizeSessionLength({ unit: 'prompts', value: null })).toEqual({
      unit: 'prompts',
      value: null,
    })
    expect(sanitizeSessionLength({ unit: 'minutes', value: null })).toEqual({
      unit: 'minutes',
      value: null,
    })
  })

  it('rounds positive counts and keeps the unit', () => {
    expect(sanitizeSessionLength({ unit: 'prompts', value: 40.4 })).toEqual({
      unit: 'prompts',
      value: 40,
    })
    expect(sanitizeSessionLength({ unit: 'minutes', value: 10 })).toEqual({
      unit: 'minutes',
      value: 10,
    })
  })

  it('falls back to the default value on a junk count', () => {
    for (const value of [0, -5, NaN, '10']) {
      expect(sanitizeSessionLength({ unit: 'minutes', value })).toEqual({
        unit: 'minutes',
        value: 20,
      })
    }
  })

  it('falls back whole on a junk length, and to prompts on a junk unit', () => {
    expect(sanitizeSessionLength(null)).toEqual(DEFAULT_SESSION_LENGTH)
    expect(sanitizeSessionLength(20)).toEqual(DEFAULT_SESSION_LENGTH)
    expect(sanitizeSessionLength({ unit: 'bars', value: 10 })).toEqual({
      unit: 'prompts',
      value: 10,
    })
  })
})

describe('sessionLengthReached (§7.2)', () => {
  const prompts = (value: number | null) =>
    ({ unit: 'prompts', value }) as const
  const minutes = (value: number | null) =>
    ({ unit: 'minutes', value }) as const

  it('never ends an ∞ session', () => {
    expect(sessionLengthReached(prompts(null), 999, 9e9)).toBe(false)
    expect(sessionLengthReached(minutes(null), 999, 9e9)).toBe(false)
  })

  it('counts prompts against a prompt length', () => {
    expect(sessionLengthReached(prompts(20), 19, 9e9)).toBe(false)
    expect(sessionLengthReached(prompts(20), 20, 0)).toBe(true)
  })

  it('counts active time against a minute length', () => {
    expect(sessionLengthReached(minutes(10), 999, 9 * 60_000)).toBe(false)
    expect(sessionLengthReached(minutes(10), 0, 10 * 60_000)).toBe(true)
  })
})
