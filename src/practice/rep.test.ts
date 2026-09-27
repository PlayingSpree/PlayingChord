import { describe, expect, it } from 'vitest'
import { BUILT_IN_VOICING_LIBRARY } from '../theory'
import type { Combo } from './combos'
import { createPoolResolver, type Pool } from './pool'
import type { Preset } from './presets'
import type { PresetProgressRecord } from './progress'
import { completeRep, repOutcome, streakAfter, type RepContext } from './rep'
import {
  InMemoryComboStats,
  MAX_TIME_TO_CORRECT_MS,
  SLOW_TIME_MS,
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

// C major as a two-octave block scale, whose grade seconds are doubled (§3.6).
const BLOCK_SCALES: Preset = {
  kind: 'scale',
  id: 'block-scales',
  name: 'Block scales',
  pool: { kind: 'product', roots: [0], scaleTypes: ['major'] },
  shapeIds: ['block'],
}

const C: Combo = { root: 0, typeId: 'maj', voicingId: 'any' }
const C_KEY = '0:maj:any'
const C_SCALE: Combo = {
  kind: 'scale',
  root: 0,
  scaleTypeId: 'major',
  shapeId: 'block',
}

const poolWith = (
  stats: ComboStatsSource,
  progress?: Partial<PresetProgressRecord>,
  preset: Preset = TRIADS,
): Pool => {
  const pool = createPoolResolver({
    presets: () => [preset],
    voicings: () => BUILT_IN_VOICING_LIBRARY,
    storedProgress: () => null,
    unlockByFifths: () => false,
    stats,
  })(preset.id, 0)
  return progress === undefined
    ? pool
    : pool.withProgress({ ...pool.progressRecord, ...progress })
}

const context = (overrides: Partial<RepContext> = {}): RepContext => {
  const stats = overrides.stats ?? new InMemoryComboStats()
  return {
    mode: 'free' as SessionMode,
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
    expect(repOutcome(clean, 1).outcome).toBe('first-try')
    expect(repOutcome(missed, 1).outcome).toBe('missed')
  })

  it('clamps the time at the ceiling', () => {
    expect(
      repOutcome({ missCount: 0, reactionMs: 800 }, 1).timeToCorrectMs,
    ).toBe(800)
    expect(
      repOutcome({ missCount: 0, reactionMs: 999_999 }, 1).timeToCorrectMs,
    ).toBe(MAX_TIME_TO_CORRECT_MS)
  })

  it('scales the ceiling by the grade scale (§3.6)', () => {
    expect(
      repOutcome({ missCount: 0, reactionMs: 999_999 }, 2).timeToCorrectMs,
    ).toBe(MAX_TIME_TO_CORRECT_MS * 2)
  })

  it('reads a missing reaction time as zero', () => {
    expect(
      repOutcome({ missCount: 0, reactionMs: null }, 1).timeToCorrectMs,
    ).toBe(0)
  })
})

describe('completeRep — where the rep lands (§5.4)', () => {
  it('records a practice rep in the persisted stats and logs it', () => {
    const ctx = context()
    const result = completeRep(clean, C, ctx)
    expect(ctx.stats.get(C_KEY)?.attempts).toBe(1)
    expect(ctx.learnStats.get(C_KEY)).toBeNull()
    expect(result.event).toEqual({
      key: C_KEY,
      label: 'C maj',
      outcome: 'first-try',
      timeToCorrectMs: 800,
    })
  })

  it('records a learn rep in the loop own stats only, with no log line', () => {
    const ctx = context({ mode: 'learn' })
    const result = completeRep(clean, C, ctx)
    expect(ctx.learnStats.get(C_KEY)?.attempts).toBe(1)
    expect(ctx.stats.get(C_KEY)).toBeNull()
    expect(result.event).toBeNull()
  })

  it('records a daily rep in the persisted stats (§5.3)', () => {
    const ctx = context({ mode: 'daily' })
    expect(completeRep(clean, C, ctx).event).not.toBeNull()
    expect(ctx.stats.get(C_KEY)?.attempts).toBe(1)
  })

  it('refuses a Song bar, which never reaches the attempt machine (§6.5)', () => {
    expect(() => completeRep(clean, C, context({ mode: 'song' }))).toThrow()
  })
})

describe('completeRep — the pass (§5.1/§7.3)', () => {
  it('passes a chord being learned that this rep takes to the bar', () => {
    const result = completeRep(clean, C, context())
    expect(result.progress?.passed).toBe('0:maj')
    expect(result.progress?.record.masteredIndices).toEqual([0])
    expect(result.progress?.opened).toEqual([])
    expect(result.justLearned).toBe(true)
  })

  it('opens the next batch when the rep passes the last unlocked chord', () => {
    const stats = new InMemoryComboStats()
    const pool = poolWith(stats, { masteredIndices: [1, 2] })
    const result = completeRep(clean, C, context({ stats, pool }))
    // F and G, the next two in the unlock order.
    expect(result.progress?.opened).toEqual(['5:maj', '7:maj'])
    expect(result.progress?.record.unlockedCount).toBe(5)
  })

  it('passes nothing when the rep does not reach the bar', () => {
    const stats = new InMemoryComboStats()
    // A long history of misses one clean rep can't lift off F.
    for (let i = 0; i < 10; i += 1) stats.record(C_KEY, 'missed', 9000)
    const result = completeRep(
      clean,
      C,
      context({ stats, pool: poolWith(stats) }),
    )
    expect(result.progress).toBeNull()
    expect(result.justLearned).toBe(false)
  })

  it('passes nothing for a chord that has already passed', () => {
    const stats = new InMemoryComboStats()
    const pool = poolWith(stats, { masteredIndices: [0] })
    expect(completeRep(clean, C, context({ stats, pool })).progress).toBeNull()
  })

  it('passes nothing for a chord that is not unlocked yet', () => {
    // F is the fourth chord, behind the frontier.
    const combo: Combo = { root: 5, typeId: 'maj', voicingId: 'any' }
    expect(completeRep(clean, combo, context()).progress).toBeNull()
  })

  it('never passes in daily practice (§5.3) or Learn (§5.4)', () => {
    expect(
      completeRep(clean, C, context({ mode: 'daily' })).progress,
    ).toBeNull()
    expect(
      completeRep(clean, C, context({ mode: 'learn' })).progress,
    ).toBeNull()
  })
})

describe('completeRep — `rehearsed` (§5.4)', () => {
  const learning = (overrides: Partial<RepContext> = {}) =>
    context({ mode: 'learn', learnSelection: ['0:maj'], ...overrides })

  it('fires when a selected chord reaches the bar on the loop own reps', () => {
    expect(completeRep(clean, C, learning()).justRehearsed).toBe(true)
  })

  it('grades on the loop own stats, never the lifetime record', () => {
    const stats = new InMemoryComboStats()
    for (let i = 0; i < 10; i += 1) stats.record(C_KEY, 'missed', 9000)
    // A lifetime F, but this session's reps are clean — the loop grades those.
    expect(
      completeRep(clean, C, learning({ stats, pool: poolWith(stats) }))
        .justRehearsed,
    ).toBe(true)
  })

  it('never fires for a filler chord — only the selection is the point', () => {
    expect(
      completeRep(clean, C, learning({ learnSelection: ['2:maj'] }))
        .justRehearsed,
    ).toBe(false)
  })

  it('fires once: a chord already at the bar is not news again', () => {
    expect(
      completeRep(clean, C, learning({ learnRehearsed: new Set(['0:maj']) }))
        .justRehearsed,
    ).toBe(false)
  })

  it('never fires outside Learn', () => {
    expect(
      completeRep(clean, C, context({ learnSelection: ['0:maj'] }))
        .justRehearsed,
    ).toBe(false)
  })
})

describe('completeRep — the grade-up climb (§7.3)', () => {
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
      completeRep(clean, C, context({ stats, pool: poolWith(stats) })).climb,
    ).toBeNull()
  })

  it('stays quiet with no record at all', () => {
    expect(completeRep(clean, C, context()).climb).toBeNull()
  })

  it('names the two letters and the combo when the grade rises', () => {
    const stats = shaky()
    const climb = completeRep(
      clean,
      C,
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
      completeRep(missed, C, context({ stats, pool: poolWith(stats) })).climb,
    ).toBeNull()
  })

  it('never fires in Learn, whose letters no record will hold (§5.4)', () => {
    const stats = shaky()
    expect(
      completeRep(
        clean,
        C,
        context({ mode: 'learn', stats, pool: poolWith(stats) }),
      ).climb,
    ).toBeNull()
  })

  it('fires in daily practice, which does record (§5.3)', () => {
    const stats = shaky()
    expect(
      completeRep(
        clean,
        C,
        context({ mode: 'daily', stats, pool: poolWith(stats) }),
      ).climb,
    ).not.toBeNull()
  })
})

describe('completeRep — the pace (§7.3)', () => {
  it('reports the recorded time, and whether it was clamped', () => {
    expect(completeRep(clean, C, context()).pace).toMatchObject({
      timeToCorrectMs: 800,
      capped: false,
    })
    expect(
      completeRep({ missCount: 0, reactionMs: 999_999 }, C, context()).pace,
    ).toMatchObject({ timeToCorrectMs: MAX_TIME_TO_CORRECT_MS, capped: true })
  })

  it('calls a rep past the D/F boundary slow, and one at A pace fast', () => {
    const slow = { missCount: 0, reactionMs: SLOW_TIME_MS + 1 }
    expect(completeRep(slow, C, context()).pace).toMatchObject({
      slow: true,
      fast: false,
    })
    expect(completeRep(clean, C, context()).pace).toMatchObject({
      slow: false,
      fast: true,
    })
  })

  it('judges no pace in Learn, which shows the answer (§7)', () => {
    const slow = { missCount: 0, reactionMs: SLOW_TIME_MS + 1 }
    expect(completeRep(slow, C, context({ mode: 'learn' })).pace).toMatchObject(
      { slow: false, fast: false },
    )
  })

  it('reads a scale in its own grade seconds (§3.6)', () => {
    const stats = new InMemoryComboStats()
    const pool = poolWith(stats, undefined, BLOCK_SCALES)
    // Slow for a chord; a block scale's seconds are doubled, so not for it.
    const rep = { missCount: 0, reactionMs: SLOW_TIME_MS + 1 }
    expect(completeRep(rep, C_SCALE, context({ stats, pool })).pace.slow).toBe(
      false,
    )
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
