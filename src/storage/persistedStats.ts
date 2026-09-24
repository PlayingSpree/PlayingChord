// The persisted ComboStatsSource (Phase 6): same interface the Phase 5
// in-memory stub implemented, backed by the versioned schema so weighting
// and worst-chords survive reloads (Milestone B). Recording a prompt outcome
// also ticks the §8 daily record — one completed prompt is one stat event.

import {
  applyOutcome,
  comboKeySide,
  gradeScaleOf,
  recentHistoryOf,
  type ComboRecentHistory,
  type ComboStatRecord,
  type ComboStatsSource,
  type PromptOutcome,
  type Side,
} from '../practice'
import type { AppStorage } from './appStorage'
import {
  EMPTY_DAILY_COUNTS,
  localDateKey,
  type DailyCounts,
  type DailyRecord,
} from './schema'

function emptyDailyRecord(date: string): DailyRecord {
  return {
    date,
    activeMinutes: 0,
    prompts: 0,
    firstTrySuccesses: 0,
    timedPrompts: 0,
    timeToCorrectMs: 0,
  }
}

// One completed prompt into the day's tallies, on its side's counters (§8):
// the top level for chords, the `scales` bucket for scales. Every prompt
// counts toward `prompts` / `firstTrySuccesses`, Song bars included; a null
// time marks a clock-paced bar (§6.5), which has no span to add and so
// leaves the timed pair — the divisor for the day's average — alone.
export function applyDailyPrompt(
  record: DailyRecord | undefined,
  date: string,
  outcome: PromptOutcome,
  timeToCorrectMs: number | null,
  side: Side = 'chords',
): DailyRecord {
  const base = record ?? emptyDailyRecord(date)
  if (side === 'scales') {
    return {
      ...base,
      scales: countPrompt(
        base.scales ?? EMPTY_DAILY_COUNTS,
        outcome,
        timeToCorrectMs,
      ),
    }
  }
  return { ...base, ...countPrompt(base, outcome, timeToCorrectMs) }
}

function countPrompt(
  base: DailyCounts,
  outcome: PromptOutcome,
  timeToCorrectMs: number | null,
): DailyCounts {
  return {
    prompts: base.prompts + 1,
    firstTrySuccesses:
      base.firstTrySuccesses + (outcome === 'first-try' ? 1 : 0),
    timedPrompts: base.timedPrompts + (timeToCorrectMs === null ? 0 : 1),
    timeToCorrectMs:
      base.timeToCorrectMs +
      (timeToCorrectMs === null ? 0 : Math.max(0, timeToCorrectMs)),
  }
}

export class PersistedComboStats implements ComboStatsSource {
  private readonly storage: AppStorage
  private readonly today: () => string

  constructor(
    storage: AppStorage,
    today: () => string = () => localDateKey(new Date()),
  ) {
    this.storage = storage
    this.today = today
  }

  get(comboKey: string): ComboStatRecord | null {
    return this.storage.state.comboStats[comboKey] ?? null
  }

  recentHistory(comboKey: string): ComboRecentHistory | null {
    return recentHistoryOf(this.get(comboKey), gradeScaleOf(comboKey))
  }

  record(
    comboKey: string,
    outcome: PromptOutcome,
    timeToCorrectMs: number | null,
  ): void {
    const date = this.today()
    this.storage.update((state) => ({
      ...state,
      comboStats: {
        ...state.comboStats,
        [comboKey]: applyOutcome(
          state.comboStats[comboKey] ?? null,
          outcome,
          timeToCorrectMs,
          gradeScaleOf(comboKey),
        ),
      },
      // Every judged prompt ticks the day, Song bars (a null time) included —
      // they're prompts the user played, so they belong in the accuracy trend
      // and the Report's lifetime total. What a bar doesn't get is a time
      // sample: applyDailyPrompt keeps it out of `timedPrompts`, so the
      // avg-time trend is never dragged toward zero by clock-paced bars.
      dailyRecords: {
        ...state.dailyRecords,
        [date]: applyDailyPrompt(
          state.dailyRecords[date],
          date,
          outcome,
          timeToCorrectMs,
          comboKeySide(comboKey),
        ),
      },
    }))
  }
}

// Where the Phase 7 active-minutes tracking lands (§7 goals/streaks) and
// what the goal chip / History read. Kept separate from ComboStatsSource:
// activity accrues in Learn mode too, where combo stats never do (§5).
export interface DailyActivitySource {
  addMinutes(minutes: number): void
  todayMinutes(): number
  records(): Readonly<Record<string, DailyRecord>>
}

export class PersistedDailyActivity implements DailyActivitySource {
  private readonly storage: AppStorage
  private readonly today: () => string

  constructor(
    storage: AppStorage,
    today: () => string = () => localDateKey(new Date()),
  ) {
    this.storage = storage
    this.today = today
  }

  addMinutes(minutes: number): void {
    if (!(minutes > 0)) return
    const date = this.today()
    this.storage.update((state) => {
      const base = state.dailyRecords[date] ?? emptyDailyRecord(date)
      return {
        ...state,
        dailyRecords: {
          ...state.dailyRecords,
          [date]: { ...base, activeMinutes: base.activeMinutes + minutes },
        },
      }
    })
  }

  todayMinutes(): number {
    return this.storage.state.dailyRecords[this.today()]?.activeMinutes ?? 0
  }

  records(): Readonly<Record<string, DailyRecord>> {
    return this.storage.state.dailyRecords
  }
}

// Test double for stores that shouldn't touch the appStorage singleton.
export class InMemoryDailyActivity implements DailyActivitySource {
  private readonly byDate: Record<string, DailyRecord> = {}
  private readonly today: () => string

  constructor(today: () => string = () => localDateKey(new Date())) {
    this.today = today
  }

  addMinutes(minutes: number): void {
    if (!(minutes > 0)) return
    const date = this.today()
    const base = this.byDate[date] ?? emptyDailyRecord(date)
    this.byDate[date] = {
      ...base,
      activeMinutes: base.activeMinutes + minutes,
    }
  }

  todayMinutes(): number {
    return this.byDate[this.today()]?.activeMinutes ?? 0
  }

  records(): Readonly<Record<string, DailyRecord>> {
    return this.byDate
  }
}

// The lifetime §7 combo-streak high score (Progress): a single persisted
// number, raised whenever a session's live streak beats it. Unlike the
// per-combo/daily records, it has no history of its own to derive a "best"
// from — the running max has to be kept. "Streak" here is the first-try run
// the UI calls a combo, not a (root, type, voicing) Combo — see
// firstTryStreak in the practice store. Kept per side since scales (§8);
// a caller that names none is on the chords side, the one there was.
export interface BestStreakSource {
  record(streak: number, side?: Side): void
}

const BEST_STREAK_FIELD = {
  chords: 'bestComboStreak',
  scales: 'bestScaleComboStreak',
} as const

export class PersistedBestStreak implements BestStreakSource {
  private readonly storage: AppStorage

  constructor(storage: AppStorage) {
    this.storage = storage
  }

  record(streak: number, side: Side = 'chords'): void {
    const field = BEST_STREAK_FIELD[side]
    if (streak <= this.storage.state[field]) return
    this.storage.update((state) => ({ ...state, [field]: streak }))
  }
}

// Test double for stores that shouldn't touch the appStorage singleton.
export class InMemoryBestStreak implements BestStreakSource {
  private readonly values: Record<Side, number> = { chords: 0, scales: 0 }

  record(streak: number, side: Side = 'chords'): void {
    this.values[side] = Math.max(this.values[side], streak)
  }

  best(side: Side = 'chords'): number {
    return this.values[side]
  }
}
