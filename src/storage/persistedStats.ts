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

export function applyDailyPrompt(
  record: DailyRecord | undefined,
  date: string,
  outcome: PromptOutcome,
): DailyRecord {
  const base = record ?? {
    date,
    activeMinutes: 0, // tracked from Phase 7 (goals/streaks)
    prompts: 0,
    firstTrySuccesses: 0,
  }
  return {
    ...base,
    prompts: base.prompts + 1,
    firstTrySuccesses:
      base.firstTrySuccesses + (outcome === 'first-try' ? 1 : 0),
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
    timeToCorrectMs: number,
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
      dailyRecords: {
        ...state.dailyRecords,
        [date]: applyDailyPrompt(state.dailyRecords[date], date, outcome),
      },
    }))
  }
}
