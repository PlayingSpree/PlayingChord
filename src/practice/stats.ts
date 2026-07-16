// Per-combo stat records (DESIGN.md §8) and the recent-outcome view feeding
// the §5 miss weighting. Pure record types + update logic live here; the
// in-memory source serves tests, the persisted one (Phase 6) lives in
// storage/ behind the same interface. Skips are never recorded (§6.2 step 4).

import { comboKey, type Combo } from './combos'

export type PromptOutcome = 'first-try' | 'missed'

// How many most-recent prompt outcomes per combo feed the miss rate.
export const RECENT_OUTCOME_WINDOW = 5

// How many time-to-correct samples are kept per combo — enough for a stable
// per-combo average without letting persisted records grow unbounded.
export const TIME_TO_CORRECT_SAMPLE_CAP = 20

// One stat record per combo (§8), keyed by comboKey. `attempts` counts
// completed prompts (skips excluded); time-to-correct is prompt shown →
// correct match, retries included (§7).
export interface ComboStatRecord {
  attempts: number
  firstTrySuccesses: number
  recentOutcomes: PromptOutcome[] // oldest first, ≤ RECENT_OUTCOME_WINDOW
  timeToCorrectMs: number[] // oldest first, ≤ TIME_TO_CORRECT_SAMPLE_CAP
}

export interface ComboRecentHistory {
  misses: number
  total: number // outcomes in the window (≤ RECENT_OUTCOME_WINDOW)
}

export interface RecentStatsSource {
  // null = no history: the combo gets the uniform baseline weight (§5).
  recentHistory(comboKey: string): ComboRecentHistory | null
}

// Full record access on top of the weighting view — what outcome recording
// and the §7 worst-chords ranking consume.
export interface ComboStatsSource extends RecentStatsSource {
  get(comboKey: string): ComboStatRecord | null
  record(
    comboKey: string,
    outcome: PromptOutcome,
    timeToCorrectMs: number,
  ): void
}

export const NO_HISTORY: RecentStatsSource = { recentHistory: () => null }

export function applyOutcome(
  record: ComboStatRecord | null,
  outcome: PromptOutcome,
  timeToCorrectMs: number,
): ComboStatRecord {
  const base = record ?? {
    attempts: 0,
    firstTrySuccesses: 0,
    recentOutcomes: [],
    timeToCorrectMs: [],
  }
  return {
    attempts: base.attempts + 1,
    firstTrySuccesses:
      base.firstTrySuccesses + (outcome === 'first-try' ? 1 : 0),
    recentOutcomes: [...base.recentOutcomes, outcome].slice(
      -RECENT_OUTCOME_WINDOW,
    ),
    timeToCorrectMs: [
      ...base.timeToCorrectMs,
      Math.max(0, Math.round(timeToCorrectMs)),
    ].slice(-TIME_TO_CORRECT_SAMPLE_CAP),
  }
}

export function recentHistoryOf(
  record: ComboStatRecord | null,
): ComboRecentHistory | null {
  if (record === null || record.recentOutcomes.length === 0) return null
  return {
    misses: record.recentOutcomes.filter((o) => o === 'missed').length,
    total: record.recentOutcomes.length,
  }
}

export class InMemoryComboStats implements ComboStatsSource {
  private readonly records = new Map<string, ComboStatRecord>()

  get(comboKey: string): ComboStatRecord | null {
    return this.records.get(comboKey) ?? null
  }

  recentHistory(comboKey: string): ComboRecentHistory | null {
    return recentHistoryOf(this.get(comboKey))
  }

  record(
    comboKey: string,
    outcome: PromptOutcome,
    timeToCorrectMs: number,
  ): void {
    this.records.set(
      comboKey,
      applyOutcome(this.get(comboKey), outcome, timeToCorrectMs),
    )
  }
}

export const WORST_CHORDS_LIMIT = 3

export interface WorstCombo {
  combo: Combo
  record: ComboStatRecord
}

// The §7 "worst chords" of a pool, from persisted records so the list
// survives reloads (Milestone B) — unlike the rest of the stats bar, which
// is session-scoped. Ranked by recent-miss rate (the same window that drives
// weighting), then lifetime first-try miss rate, then attempts (more
// evidence ranks worse), then key for determinism. Combos never practiced or
// never missed don't qualify — "worst" implies a miss somewhere.
// A pool for the §7 "worst chords only" Practice setting: every combo in
// the preset that qualifies as "worst" (missed somewhere), in worst-first
// order — the display list is the limit-3 head of the same ranking.
export function rankWorstCombos(
  pool: readonly Combo[],
  stats: ComboStatsSource,
  limit = WORST_CHORDS_LIMIT,
): WorstCombo[] {
  const scored = pool.flatMap((combo) => {
    const record = stats.get(comboKey(combo))
    if (record === null || record.attempts === 0) return []
    const recent = recentHistoryOf(record)
    const recentMissRate = recent === null ? 0 : recent.misses / recent.total
    const lifetimeMissRate = 1 - record.firstTrySuccesses / record.attempts
    if (recentMissRate === 0 && lifetimeMissRate === 0) return []
    return [{ combo, record, recentMissRate, lifetimeMissRate }]
  })
  scored.sort(
    (a, b) =>
      b.recentMissRate - a.recentMissRate ||
      b.lifetimeMissRate - a.lifetimeMissRate ||
      b.record.attempts - a.record.attempts ||
      comboKey(a.combo).localeCompare(comboKey(b.combo)),
  )
  return scored.slice(0, limit).map(({ combo, record }) => ({ combo, record }))
}

// How many attempts a combo needs before "improvement" means anything —
// a single lucky recent window on 2 attempts isn't a trend.
export const IMPROVED_MIN_ATTEMPTS = 5

export interface ImprovedCombo {
  combo: Combo
  record: ComboStatRecord
  // Lifetime miss rate minus recent-window miss rate, in (0, 1]: how much
  // better the recent window is than the combo's overall history.
  improvement: number
}

// The §7 History "most improved" chords: combos whose recent window beats
// their lifetime miss rate. Requires a full-enough history (attempts and a
// populated recent window) so fresh combos can't rank.
export function rankMostImproved(
  pool: readonly Combo[],
  stats: ComboStatsSource,
  limit = WORST_CHORDS_LIMIT,
): ImprovedCombo[] {
  const scored = pool.flatMap((combo) => {
    const record = stats.get(comboKey(combo))
    if (record === null || record.attempts < IMPROVED_MIN_ATTEMPTS) return []
    const recent = recentHistoryOf(record)
    if (recent === null || recent.total < RECENT_OUTCOME_WINDOW) return []
    const lifetimeMissRate = 1 - record.firstTrySuccesses / record.attempts
    const improvement = lifetimeMissRate - recent.misses / recent.total
    if (improvement <= 0) return []
    return [{ combo, record, improvement }]
  })
  scored.sort(
    (a, b) =>
      b.improvement - a.improvement ||
      b.record.attempts - a.record.attempts ||
      comboKey(a.combo).localeCompare(comboKey(b.combo)),
  )
  return scored.slice(0, limit)
}
