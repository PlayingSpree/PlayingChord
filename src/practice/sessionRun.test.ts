import { describe, expect, it } from 'vitest'
import { SessionRun, type SessionRunContext } from './sessionRun'
import {
  summarizeSession,
  type SessionEvent,
  type SessionMode,
} from './session'

const event = (
  key: string,
  outcome: SessionEvent['outcome'],
  timeToCorrectMs: number | null = 1000,
): SessionEvent => ({ key, label: key, outcome, timeToCorrectMs })

// The non-session half of the Report's inputs, which the store assembles from
// storage and the active pool — a literal here, since the run doesn't care
// where they came from.
const context = (
  overrides: Partial<SessionRunContext> = {},
): SessionRunContext => ({
  mode: 'free' as SessionMode,
  promptsPlayed: 0,
  records: {},
  todayKey: '2026-08-02',
  lifetime: { prompts: 0, activeMinutes: 0 },
  goal: { todayMinutes: 0, streak: 0 },
  chords: [],
  setAside: [],
  unlockedTotals: { unlocked: 4, passed: 2, total: 12 },
  learnRemaining: [],
  ...overrides,
})

describe('SessionRun — tallies (§7.2)', () => {
  it('starts empty', () => {
    const run = new SessionRun()
    expect(run.events).toEqual([])
    expect(run.activeMs).toBe(0)
    expect(run.stats()).toEqual({
      prompts: 0,
      firstTrySuccesses: 0,
      totalTimeToCorrectMs: 0,
    })
  })

  it('reports the live tallies without the Report-only mean time', () => {
    const run = new SessionRun()
    run.logEvent(event('a', 'first-try', 1000))
    run.logEvent(event('a', 'missed', 3000))
    run.logEvent(event('bar', 'first-try', null)) // a Song bar (§6.5)

    const stats = run.stats()
    expect(stats).toEqual({
      prompts: 3,
      firstTrySuccesses: 2,
      totalTimeToCorrectMs: 4000,
    })
    // Same fold as the Report's, minus the mean it derives for itself.
    const summary = summarizeSession(run.events)
    expect(summary.prompts).toBe(stats.prompts)
    expect(summary.totalTimeToCorrectMs).toBe(stats.totalTimeToCorrectMs)
    expect(stats).not.toHaveProperty('avgTimeToCorrectMs')
  })

  it('accumulates active time', () => {
    const run = new SessionRun()
    run.addActiveMs(1500)
    run.addActiveMs(2500)
    expect(run.activeMs).toBe(4000)
  })

  it('names a passed chord once, in the order it got there', () => {
    const run = new SessionRun()
    run.notePassed('Am')
    run.notePassed('C')
    run.notePassed('Am') // more reps of an already-passed chord
    expect(run.report(context()).passedLabels).toEqual(['Am', 'C'])
  })

  it('names an unlocked chord once across batches', () => {
    const run = new SessionRun()
    run.noteUnlocked(['D', 'E'])
    run.noteUnlocked(['E', 'F'])
    expect(run.report(context()).unlocked?.labels).toEqual(['D', 'E', 'F'])
  })

  it('names a rehearsed chord once (§5.4)', () => {
    const run = new SessionRun()
    run.noteRehearsed('G')
    run.noteRehearsed('G')
    const report = run.report(context({ mode: 'learn' }))
    expect(report.learn?.rehearsed).toEqual(['G'])
  })
})

describe('SessionRun — grade-up announcements (§7.3)', () => {
  it('is news the first time and not after', () => {
    const run = new SessionRun()
    expect(run.announceGradeUp('C:maj:root', 'A')).toBe(true)
    expect(run.announceGradeUp('C:maj:root', 'A')).toBe(false)
  })

  it('is news again for a different grade, and for a different combo', () => {
    const run = new SessionRun()
    expect(run.announceGradeUp('C:maj:root', 'B')).toBe(true)
    expect(run.announceGradeUp('C:maj:root', 'A')).toBe(true)
    expect(run.announceGradeUp('D:min:root', 'B')).toBe(true)
  })

  it('hears the same climb again in a fresh run', () => {
    expect(new SessionRun().announceGradeUp('C:maj:root', 'A')).toBe(true)
    expect(new SessionRun().announceGradeUp('C:maj:root', 'A')).toBe(true)
  })
})

describe('SessionRun — report assembly (§7.4)', () => {
  it('increments prompts by its own log and time by its own clock', () => {
    const run = new SessionRun()
    run.logEvent(event('a', 'first-try'))
    run.logEvent(event('b', 'missed'))
    run.addActiveMs(90_000)

    // promptsPlayed counts Learn reps too, which log nothing — so the two
    // deliberately disagree (§7.2).
    const report = run.report(context({ promptsPlayed: 5 }))
    expect(report.promptsPlayed).toBe(5)
    expect(report.recordedPrompts).toBe(2)
    expect(report.increment).toEqual({ prompts: 2, activeMinutes: 1.5 })
  })

  it('omits the unlock banner when nothing opened', () => {
    const run = new SessionRun()
    run.logEvent(event('a', 'first-try'))
    expect(run.report(context()).unlocked).toBeNull()
  })

  it('carries the pool standing into the banner when something did', () => {
    const run = new SessionRun()
    run.noteUnlocked(['D'])
    expect(run.report(context()).unlocked).toEqual({
      labels: ['D'],
      unlocked: 4,
      passed: 2,
      total: 12,
    })
  })

  it('reports the learn block only where the loop runs (§5.4)', () => {
    const run = new SessionRun()
    run.noteRehearsed('G')
    const ctx = context({ learnRemaining: ['Am'] })

    expect(run.report({ ...ctx, mode: 'learn' }).learn).toEqual({
      rehearsed: ['G'],
      remaining: ['Am'],
    })
    for (const mode of ['free', 'daily', 'song'] as const) {
      expect(run.report({ ...ctx, mode }).learn).toBeNull()
    }
  })

  it('hands its log to the derivations — grade and still-shaky (§7.4)', () => {
    const run = new SessionRun()
    run.logEvent(event('Am', 'first-try'))
    run.logEvent(event('C', 'missed'))
    run.logEvent(event('C', 'missed'))

    const report = run.report(context({ promptsPlayed: 3 }))
    expect(report.accuracy).toBeCloseTo(1 / 3)
    expect(report.grade).not.toBeNull()
    expect(report.shaky).toEqual([{ label: 'C', misses: 2 }])
  })

  it('does not hand out its own arrays', () => {
    const run = new SessionRun()
    run.notePassed('Am')
    const report = run.report(context())
    report.passedLabels.push('tampered')
    expect(run.report(context()).passedLabels).toEqual(['Am'])
  })
})
