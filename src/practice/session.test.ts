import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SESSION_LENGTH,
  effectiveLength,
  MODE_POLICY,
  sanitizeSessionLength,
  sessionLengthReached,
  summarizeSession,
  UNLIMITED_LENGTH,
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

// Not a restatement of the table — the store's own tests cover what each mode
// does. These are the relations that have to hold *between* fields, so a row
// added for a new mode can't quietly claim a combination that means nothing.
describe('MODE_POLICY invariants (§7)', () => {
  const policies = Object.values(MODE_POLICY)

  it('only announces a pass in a mode that can record one (§5.1/§7.3)', () => {
    for (const policy of policies) {
      if (policy.announcesLearned) {
        expect(policy.movesUnlockProgress).toBe(true)
      }
    }
  })

  it('never moves the unlock queue on session-local reps (§5.4)', () => {
    for (const policy of policies) {
      if (policy.statsSource === 'session') {
        expect(policy.movesUnlockProgress).toBe(false)
      }
    }
  })

  it('only announces a rehearsal where the loop runs (§5.4)', () => {
    for (const policy of policies) {
      if (policy.announcesRehearsed) expect(policy.hasLearnLoop).toBe(true)
    }
  })

  it('never gates a clock-paced mode on ready (§6.5/§7.3)', () => {
    for (const policy of policies) {
      if (policy.clockPaced) expect(policy.gatesOnReady).toBe(false)
    }
  })
})

describe('effectiveLength (§7.2)', () => {
  const drafted = { unit: 'prompts', value: 40 } as const

  it('gives free practice the length it drafted', () => {
    expect(effectiveLength('free', drafted, 15)).toEqual(drafted)
  })

  it('gives daily practice its persisted cap in minutes (§5.3)', () => {
    expect(effectiveLength('daily', drafted, 15)).toEqual({
      unit: 'minutes',
      value: 15,
    })
  })

  it('gives Learn and Song no length to run out (§5.4/§6.5)', () => {
    expect(effectiveLength('learn', drafted, 15)).toEqual(UNLIMITED_LENGTH)
    expect(effectiveLength('song', drafted, 15)).toEqual(UNLIMITED_LENGTH)
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
