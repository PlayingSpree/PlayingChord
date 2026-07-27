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
