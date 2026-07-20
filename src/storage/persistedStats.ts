// The persisted ComboStatsSource (Phase 6): same interface the Phase 5
// in-memory stub implemented, backed by the versioned schema so weighting
// and worst-chords survive reloads (Milestone B). Recording a prompt outcome
// also ticks the §8 daily record — one completed prompt is one stat event.

import {
  applyOutcome,
  recentHistoryOf,
  type ComboRecentHistory,
  type ComboStatRecord,
  type ComboStatsSource,
  type PromptOutcome,
} from '../practice'
import type { AppStorage } from './appStorage'
import { localDateKey, type DailyRecord } from './schema'

function emptyDailyRecord(date: string): DailyRecord {
  return {
    date,
    activeMinutes: 0,
    prompts: 0,
    firstTrySuccesses: 0,
    timeToCorrectMs: 0,
  }
}

export function applyDailyPrompt(
  record: DailyRecord | undefined,
  date: string,
  outcome: PromptOutcome,
  timeToCorrectMs: number,
): DailyRecord {
  const base = record ?? emptyDailyRecord(date)
  return {
    ...base,
    prompts: base.prompts + 1,
    firstTrySuccesses:
      base.firstTrySuccesses + (outcome === 'first-try' ? 1 : 0),
    timeToCorrectMs: base.timeToCorrectMs + Math.max(0, timeToCorrectMs),
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
    return recentHistoryOf(this.get(comboKey))
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
        ),
      },
      // A null time is a Song-mode bar (§6.5): it feeds the per-combo record
      // only. Daily prompt tallies drive History's accuracy/avg-time trends,
      // whose populations are self-paced prompts — a 0-time bar would drag
      // the avg-time trend toward zero.
      dailyRecords:
        timeToCorrectMs === null
          ? state.dailyRecords
          : {
              ...state.dailyRecords,
              [date]: applyDailyPrompt(
                state.dailyRecords[date],
                date,
                outcome,
                timeToCorrectMs,
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

// The lifetime §7 combo-streak high score (History tab): a single persisted
// number, raised whenever a session's live streak beats it. Unlike the
// per-combo/daily records, it has no history of its own to derive a "best"
// from — the running max has to be kept.
export interface BestComboSource {
  record(streak: number): void
}

export class PersistedBestCombo implements BestComboSource {
  private readonly storage: AppStorage

  constructor(storage: AppStorage) {
    this.storage = storage
  }

  record(streak: number): void {
    if (streak <= this.storage.state.bestComboStreak) return
    this.storage.update((state) => ({ ...state, bestComboStreak: streak }))
  }
}

// Test double for stores that shouldn't touch the appStorage singleton.
export class InMemoryBestCombo implements BestComboSource {
  private value = 0

  record(streak: number): void {
    this.value = Math.max(this.value, streak)
  }

  best(): number {
    return this.value
  }
}
