// Per-combo recent-outcome history feeding the §5 miss weighting. This is
// the in-memory stub PLAN.md Phase 5 calls for; Phase 6 replaces the backing
// store with persisted per-combo stat records but keeps this interface.
// Skips are never recorded (§6.2 step 4).

export type PromptOutcome = 'first-try' | 'missed'

// How many most-recent prompt outcomes per combo feed the miss rate.
export const RECENT_OUTCOME_WINDOW = 5

export interface ComboRecentHistory {
  misses: number
  total: number // outcomes in the window (≤ RECENT_OUTCOME_WINDOW)
}

export interface RecentStatsSource {
  // null = no history: the combo gets the uniform baseline weight (§5).
  recentHistory(comboKey: string): ComboRecentHistory | null
}

export const NO_HISTORY: RecentStatsSource = { recentHistory: () => null }

export class InMemoryRecentStats implements RecentStatsSource {
  private readonly outcomes = new Map<string, PromptOutcome[]>()

  record(comboKey: string, outcome: PromptOutcome): void {
    const list = this.outcomes.get(comboKey) ?? []
    list.push(outcome)
    if (list.length > RECENT_OUTCOME_WINDOW) list.shift()
    this.outcomes.set(comboKey, list)
  }

  recentHistory(comboKey: string): ComboRecentHistory | null {
    const list = this.outcomes.get(comboKey)
    if (!list || list.length === 0) return null
    return {
      misses: list.filter((outcome) => outcome === 'missed').length,
      total: list.length,
    }
  }
}
