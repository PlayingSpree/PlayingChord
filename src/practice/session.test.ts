import { describe, expect, it } from 'vitest'
import {
  sanitizeTimerMinutes,
  summarizeSession,
  type SessionEvent,
} from './session'

const event = (
  key: string,
  outcome: SessionEvent['outcome'],
  timeToCorrectMs: number,
): SessionEvent => ({ key, label: key, outcome, timeToCorrectMs })

describe('summarizeSession (§7 end-of-session summary)', () => {
  it('summarizes an empty session', () => {
    expect(summarizeSession([])).toEqual({
      prompts: 0,
      firstTrySuccesses: 0,
      totalTimeToCorrectMs: 0,
      slowest: [],
      worst: [],
    })
  })

  it('tallies prompts, first-try successes and total time', () => {
    const summary = summarizeSession([
      event('a', 'first-try', 1000),
      event('a', 'missed', 3000),
      event('b', 'first-try', 2000),
    ])
    expect(summary.prompts).toBe(3)
    expect(summary.firstTrySuccesses).toBe(2)
    expect(summary.totalTimeToCorrectMs).toBe(6000)
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

  it('caps both lists at 3 entries', () => {
    const events = ['a', 'b', 'c', 'd', 'e'].map((k) => event(k, 'missed', 1))
    const summary = summarizeSession(events)
    expect(summary.slowest).toHaveLength(3)
    expect(summary.worst).toHaveLength(3)
  })
})

describe('sanitizeTimerMinutes', () => {
  it('rounds valid minutes and clamps to the maximum', () => {
    expect(sanitizeTimerMinutes(5)).toBe(5)
    expect(sanitizeTimerMinutes(7.6)).toBe(8)
    expect(sanitizeTimerMinutes(999)).toBe(180)
  })

  it('rejects junk', () => {
    expect(sanitizeTimerMinutes(0)).toBeNull()
    expect(sanitizeTimerMinutes(-5)).toBeNull()
    expect(sanitizeTimerMinutes(NaN)).toBeNull()
    expect(sanitizeTimerMinutes('10')).toBeNull()
  })
})
