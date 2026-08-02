import { describe, expect, it } from 'vitest'
import { BUILT_IN_VOICING_LIBRARY } from '../theory'
import {
  judgeCallouts,
  repOutcome,
  streakAfter,
  type CalloutContext,
} from './callouts'
import { createPoolResolver, type Pool } from './pool'
import type { Preset } from './presets'
import type { PresetProgressRecord } from './progress'
import {
  InMemoryComboStats,
  MAX_TIME_TO_CORRECT_MS,
  type ComboStatsSource,
} from './stats'
import type { SessionMode } from './session'

// Six roots × one type × one voicing, so a chord and a combo are the same
// thing: C D E F G A, with the initial three unlocked.
const TRIADS: Preset = {
  id: 'triads',
  name: 'Triads',
  pool: { kind: 'product', roots: [0, 2, 4, 5, 7, 9], chordTypes: ['maj'] },
  voicingIds: ['any'],
}

const C = { root: 0 as const, typeId: 'maj' as const, voicingId: 'any' }
const C_KEY = '0:maj:any'

const poolWith = (
  stats: ComboStatsSource,
  progress?: Partial<PresetProgressRecord>,
): Pool => {
  const pool = createPoolResolver({
    presets: () => [TRIADS],
    voicings: () => BUILT_IN_VOICING_LIBRARY,
    storedProgress: () => null,
    unlockByFifths: () => false,
    stats,
  })('triads', 0)
  return progress === undefined
    ? pool
    : pool.withProgress({ ...pool.progressRecord, ...progress })
}

const context = (overrides: Partial<CalloutContext> = {}): CalloutContext => {
  const stats = overrides.stats ?? new InMemoryComboStats()
  return {
    mode: 'free' as SessionMode,
    combo: C,
    pool: poolWith(stats),
    stats,
    learnStats: new InMemoryComboStats(),
    learnSelection: [],
    learnRehearsed: new Set(),
    ...overrides,
  }
}

// A ✔ on the first try, and a ✘-then-✔.
const clean = { missCount: 0, reactionMs: 800 }
const missed = { missCount: 1, reactionMs: 5000 }

describe('repOutcome (§6.2)', () => {
  it('is first-try only when nothing was missed', () => {
    expect(repOutcome(clean).outcome).toBe('first-try')
    expect(repOutcome(missed).outcome).toBe('missed')
  })

  it('clamps the time at the ceiling', () => {
    expect(repOutcome({ missCount: 0, reactionMs: 800 }).timeToCorrectMs).toBe(
      800,
    )
    expect(
      repOutcome({ missCount: 0, reactionMs: 999_999 }).timeToCorrectMs,
    ).toBe(MAX_TIME_TO_CORRECT_MS)
  })

  it('reads a missing reaction time as zero', () => {
    expect(repOutcome({ missCount: 0, reactionMs: null }).timeToCorrectMs).toBe(
      0,
    )
  })
})

describe('judgeCallouts — when there is nothing to judge', () => {
  it('says nothing without a combo on screen', () => {
    expect(judgeCallouts(clean, context({ combo: null }))).toEqual({
      justLearned: false,
      justRehearsed: false,
      climb: null,
    })
  })

  it('says nothing in Song, whose bars never reach the machine (§6.5)', () => {
    expect(judgeCallouts(clean, context({ mode: 'song' }))).toEqual({
      justLearned: false,
      justRehearsed: false,
      climb: null,
    })
  })
})

describe('judgeCallouts — `learned` (§5.1/§7.3)', () => {
  it('fires when this rep takes a chord being learned to the pass bar', () => {
    expect(judgeCallouts(clean, context()).justLearned).toBe(true)
  })

  it('stays quiet when the rep does not reach the bar', () => {
    const stats = new InMemoryComboStats()
    // A long history of misses one clean rep can't lift off F.
    for (let i = 0; i < 10; i += 1) stats.record(C_KEY, 'missed', 9000)
    expect(
      judgeCallouts(clean, context({ stats, pool: poolWith(stats) }))
        .justLearned,
    ).toBe(false)
  })

  it('stays quiet for a chord that has already passed (§5.1)', () => {
    const stats = new InMemoryComboStats()
    const pool = poolWith(stats, { masteredIndices: [0] })
    expect(judgeCallouts(clean, context({ stats, pool })).justLearned).toBe(
      false,
    )
  })

  it('stays quiet for a chord that is not unlocked yet', () => {
    const stats = new InMemoryComboStats()
    // F is the fourth chord, behind the frontier.
    const combo = { root: 5 as const, typeId: 'maj' as const, voicingId: 'any' }
    expect(
      judgeCallouts(clean, context({ stats, pool: poolWith(stats), combo }))
        .justLearned,
    ).toBe(false)
  })

  it('never fires in daily practice, which passes nothing (§5.3)', () => {
    expect(judgeCallouts(clean, context({ mode: 'daily' })).justLearned).toBe(
      false,
    )
  })

  it('never fires in Learn, whose grades are session-local (§5.4)', () => {
    expect(judgeCallouts(clean, context({ mode: 'learn' })).justLearned).toBe(
      false,
    )
  })
})

describe('judgeCallouts — `rehearsed` (§5.4)', () => {
  const learning = (overrides: Partial<CalloutContext> = {}) =>
    context({ mode: 'learn', learnSelection: ['0:maj'], ...overrides })

  it('fires when a selected chord reaches the bar on the loop own reps', () => {
    expect(judgeCallouts(clean, learning()).justRehearsed).toBe(true)
  })

  it('grades on the loop own stats, never the lifetime record', () => {
    const stats = new InMemoryComboStats()
    for (let i = 0; i < 10; i += 1) stats.record(C_KEY, 'missed', 9000)
    const learnStats = new InMemoryComboStats()
    // A lifetime F, but this session's reps are clean — the loop grades those.
    expect(
      judgeCallouts(
        clean,
        learning({ stats, pool: poolWith(stats), learnStats }),
      ).justRehearsed,
    ).toBe(true)
  })

  it('never fires for a filler chord — only the selection is the point', () => {
    expect(
      judgeCallouts(clean, learning({ learnSelection: ['2:maj'] }))
        .justRehearsed,
    ).toBe(false)
  })

  it('fires once: a chord already at the bar is not news again', () => {
    expect(
      judgeCallouts(clean, learning({ learnRehearsed: new Set(['0:maj']) }))
        .justRehearsed,
    ).toBe(false)
  })

  it('never fires outside Learn', () => {
    expect(
      judgeCallouts(clean, context({ learnSelection: ['0:maj'] }))
        .justRehearsed,
    ).toBe(false)
  })
})

describe('judgeCallouts — the grade-up climb (§7.3)', () => {
  // Ten attempts — clear of the evidence floor — sitting at F with the recent
  // window half clean, so one more clean rep is enough to lift the letter.
  const shaky = (): InMemoryComboStats => {
    const stats = new InMemoryComboStats()
    for (let i = 0; i < 5; i += 1) stats.record(C_KEY, 'missed', 9000)
    for (let i = 0; i < 5; i += 1) stats.record(C_KEY, 'first-try', 900)
    return stats
  }

  it('stays quiet below the evidence floor, where a letter swings on one rep', () => {
    const stats = new InMemoryComboStats()
    stats.record(C_KEY, 'missed', 9000) // 1 attempt, floor is 5
    expect(
      judgeCallouts(clean, context({ stats, pool: poolWith(stats) })).climb,
    ).toBeNull()
  })

  it('stays quiet with no record at all', () => {
    expect(judgeCallouts(clean, context()).climb).toBeNull()
  })

  it('names the two letters and the combo when the grade rises', () => {
    const stats = shaky()
    const climb = judgeCallouts(
      clean,
      context({ stats, pool: poolWith(stats) }),
    ).climb
    expect(climb).not.toBeNull()
    expect(climb?.key).toBe(C_KEY)
    // The name the combo goes by in the chord stats (§7.5), not the compact
    // chip label — the chip is naming a row the player can go and look at.
    expect(climb?.label).toBe('C maj')
    expect(climb?.from).toBe('F')
    expect(climb?.to).not.toBe('F')
  })

  it('stays quiet when the rep does not raise the letter', () => {
    const stats = shaky()
    expect(
      judgeCallouts(missed, context({ stats, pool: poolWith(stats) })).climb,
    ).toBeNull()
  })

  it('never fires in Learn, whose letters no record will hold (§5.4)', () => {
    const stats = shaky()
    expect(
      judgeCallouts(
        clean,
        context({ mode: 'learn', stats, pool: poolWith(stats) }),
      ).climb,
    ).toBeNull()
  })

  it('fires in daily practice, which does record (§5.3)', () => {
    const stats = shaky()
    expect(
      judgeCallouts(
        clean,
        context({ mode: 'daily', stats, pool: poolWith(stats) }),
      ).climb,
    ).not.toBeNull()
  })
})

describe('streakAfter (§7.3)', () => {
  const at = (firstTryStreak: number) => ({
    missCount: 0,
    phase: 'awaiting',
    firstTryStreak,
  })

  it('counts a first-try ✔ on the edge into advancing', () => {
    expect(streakAfter(at(4), { missCount: 0, phase: 'advancing' })).toBe(5)
  })

  it('counts nothing while already advancing — the edge is the moment', () => {
    expect(
      streakAfter(
        { missCount: 0, phase: 'advancing', firstTryStreak: 4 },
        { missCount: 0, phase: 'advancing' },
      ),
    ).toBeNull()
  })

  it('counts nothing for a ✔ that took more than one try', () => {
    // The miss already dropped the streak when the ✘ landed; reaching the ✔
    // afterwards must not count it back.
    expect(
      streakAfter(
        { missCount: 1, phase: 'awaiting', firstTryStreak: 0 },
        { missCount: 1, phase: 'advancing' },
      ),
    ).toBeNull()
  })

  it('drops the streak again if a fresh miss lands in the same attempt', () => {
    expect(
      streakAfter(
        { missCount: 1, phase: 'awaiting', firstTryStreak: 4 },
        { missCount: 2, phase: 'awaiting' },
      ),
    ).toBe(0)
  })

  it('drops the streak the moment the ✘ lands, not on the advance', () => {
    expect(streakAfter(at(9), { missCount: 1, phase: 'awaiting' })).toBe(0)
  })

  it('writes nothing when a miss lands on a streak already at zero', () => {
    expect(streakAfter(at(0), { missCount: 1, phase: 'awaiting' })).toBeNull()
  })

  it('leaves an in-flight attempt alone', () => {
    expect(streakAfter(at(4), { missCount: 0, phase: 'awaiting' })).toBeNull()
  })
})
