// Per-combo stat records (DESIGN.md §8) and the recent-outcome view feeding
// the §5 miss weighting. Pure record types + update logic live here; the
// in-memory source serves tests, the persisted one (Phase 6) lives in
// storage/ behind the same interface. Skips are never recorded (§6.2 step 4).

import { comboKey, parseComboKey, type Combo } from './combos'
import { FAST_TIME_MS } from './progress'
import type { VoicingLibrary } from '../theory'

export type PromptOutcome = 'first-try' | 'missed'

// How many most-recent prompt outcomes per combo feed the miss rate.
export const RECENT_OUTCOME_WINDOW = 5

// How many time-to-correct samples are kept per combo — enough for a stable
// per-combo average without letting persisted records grow unbounded.
export const TIME_TO_CORRECT_SAMPLE_CAP = 20

// How many of those samples count as "recent" for the §7 chord stats page's
// recent-average time-to-correct. Deliberately its own constant rather than
// RECENT_OUTCOME_WINDOW: that window is sized for weighting (and is the most
// outcomes ever persisted per combo, so accuracy can't recover a bigger
// one), while time samples have room up to TIME_TO_CORRECT_SAMPLE_CAP. Half
// the cap smooths out one lucky/unlucky rep while still reading as "recent"
// against the full lifetime average.
export const RECENT_TIME_WINDOW = TIME_TO_CORRECT_SAMPLE_CAP / 2

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
  // Recent time-to-correct average feeding comboScore below — its own
  // window (RECENT_TIME_WINDOW), the same split comboMetrics uses since
  // more time samples are kept per combo than outcomes. Null when every
  // sample is a Song-mode bar, or there's no time history yet.
  avgTimeToCorrectMs: number | null
}

export interface RecentStatsSource {
  // null = no history: the combo gets the uniform baseline weight (§5).
  recentHistory(comboKey: string): ComboRecentHistory | null
}

// Full record access on top of the weighting view — what outcome recording
// and the §7 worst-chords ranking consume.
export interface ComboStatsSource extends RecentStatsSource {
  get(comboKey: string): ComboStatRecord | null
  // timeToCorrectMs is null for Song-mode bars (§6.5): a clock-paced bar has
  // no "prompt shown → correct" span, so no time sample is stored.
  record(
    comboKey: string,
    outcome: PromptOutcome,
    timeToCorrectMs: number | null,
  ): void
}

export const NO_HISTORY: RecentStatsSource = { recentHistory: () => null }

export function applyOutcome(
  record: ComboStatRecord | null,
  outcome: PromptOutcome,
  timeToCorrectMs: number | null,
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
    timeToCorrectMs:
      timeToCorrectMs === null
        ? base.timeToCorrectMs
        : [
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
    avgTimeToCorrectMs: average(
      record.timeToCorrectMs.slice(-RECENT_TIME_WINDOW),
    ),
  }
}

// The proficiency score behind both §5 prioritization and the §7 chord
// stats grade: recent accuracy scaled down by how far the recent average
// time-to-correct sits above the pass speed bar (FAST_TIME_MS, §5.1) —
// full credit at or under it, decaying smoothly past it. Multiplicative,
// not averaged, so being fast can't offset being wrong or vice versa — the
// same AND logic the pass gate itself uses. No time data (Song-mode-only
// combos, or no history at all) gets full speed credit — never penalize for
// data that isn't there.
function scoreOf(accuracy: number, avgTimeToCorrectMs: number | null): number {
  const speedFactor =
    avgTimeToCorrectMs === null
      ? 1
      : Math.min(1, FAST_TIME_MS / avgTimeToCorrectMs)
  return accuracy * speedFactor
}

// A combo with no recent history scores at the uniform baseline (1), same
// as comboWeight's old no-history case — a fresh combo is neither penalized
// nor favored.
export function comboScore(history: ComboRecentHistory | null): number {
  if (history === null || history.total === 0) return 1
  return scoreOf(1 - history.misses / history.total, history.avgTimeToCorrectMs)
}

// The §7.4 session grade reuses the very same accuracy-scaled-by-speed math
// as the per-combo score, fed a whole session's first-try accuracy and mean
// time-to-correct — so a session grade and a chord grade mean the same thing.
// A null time (a Song-only session) gets full speed credit, exactly as §5
// scores such combos.
export function sessionScore(
  accuracy: number,
  avgTimeToCorrectMs: number | null,
): number {
  return scoreOf(accuracy, avgTimeToCorrectMs)
}

export type ComboGrade = 'A' | 'B' | 'C' | 'D' | 'F'

// Letter tiers over comboScore for the §7 chord stats page — a compact,
// sortable read on "how's this combo doing" that folds accuracy and speed
// into one glance.
export function comboGrade(score: number): ComboGrade {
  if (score >= 0.9) return 'A'
  if (score >= 0.75) return 'B'
  if (score >= 0.55) return 'C'
  if (score >= 0.35) return 'D'
  return 'F'
}

// A chord's grade for Home's "In play" row (§7.1) when it spans several
// voicing combos: the *worst* (lowest-scoring) combo's grade, surfacing the
// weakest voicing rather than averaging it away. null when no combo has any
// history yet (the chord reads as "learning" instead of graded).
export function worstChordGrade(
  records: readonly ComboStatRecord[],
): ComboGrade | null {
  let worstScore: number | null = null
  for (const record of records) {
    const { score } = comboMetrics(record)
    worstScore = worstScore === null ? score : Math.min(worstScore, score)
  }
  return worstScore === null ? null : comboGrade(worstScore)
}

// A per-combo metrics snapshot for the §7 chord stats page — every persisted
// combo, not just the top-N worst/most-improved lists. Lifetime figures use
// the full stored history. The two recent figures use different windows:
// recentAccuracy uses RECENT_OUTCOME_WINDOW, the same one that drives
// weighting and rankWorstCombos, because that's the most outcomes ever kept
// per combo; recentAvgTimeToCorrectMs uses the wider RECENT_TIME_WINDOW,
// since time samples have more room to work with (see both constants above).
export interface ComboMetrics {
  attempts: number
  lifetimeAccuracy: number
  recentAccuracy: number
  // null when every sample is a Song-mode bar (§6.5), which records no
  // time-to-correct span.
  lifetimeAvgTimeToCorrectMs: number | null
  recentAvgTimeToCorrectMs: number | null
  // comboScore(recentAccuracy, recentAvgTimeToCorrectMs) and its letter
  // tier — the same figure that drives §5 weighting.
  score: number
  grade: ComboGrade
}

function average(samples: readonly number[]): number | null {
  return samples.length > 0
    ? samples.reduce((sum, ms) => sum + ms, 0) / samples.length
    : null
}

export function comboMetrics(record: ComboStatRecord): ComboMetrics {
  const recent = recentHistoryOf(record)
  const recentAccuracy = recent === null ? 1 : 1 - recent.misses / recent.total
  const recentAvgTimeToCorrectMs = average(
    record.timeToCorrectMs.slice(-RECENT_TIME_WINDOW),
  )
  const score = scoreOf(recentAccuracy, recentAvgTimeToCorrectMs)
  return {
    attempts: record.attempts,
    lifetimeAccuracy: record.firstTrySuccesses / record.attempts,
    recentAccuracy,
    lifetimeAvgTimeToCorrectMs: average(record.timeToCorrectMs),
    recentAvgTimeToCorrectMs,
    score,
    grade: comboGrade(score),
  }
}

export interface ComboRow {
  key: string
  combo: Combo
  record: ComboStatRecord
}

// Every persisted combo resolved back to a Combo (§7 chord stats page,
// shared with History's worst/most-improved lists) — stale keys naming a
// removed chord type or a deleted custom voicing rule are dropped rather
// than crashing a display path (parseComboKey, §8).
export function allComboRows(
  comboStats: Readonly<Record<string, ComboStatRecord>>,
  library?: VoicingLibrary,
): ComboRow[] {
  return Object.entries(comboStats).flatMap(([key, record]) => {
    const combo = parseComboKey(key, library)
    return combo === null ? [] : [{ key, combo, record }]
  })
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
    timeToCorrectMs: number | null,
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
// is session-scoped. Ranked by chord score (accuracy scaled by speed, same
// figure as §5 weighting), then recent-miss rate, then lifetime first-try
// miss rate, then attempts (more evidence ranks worse), then key for
// determinism. Combos never practiced or never missed don't qualify —
// "worst" implies a miss somewhere, so a combo that's merely slow (but
// always correct) still doesn't show up here even though it scores below 1.
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
    const score = comboScore(recent)
    return [{ combo, record, score, recentMissRate, lifetimeMissRate }]
  })
  scored.sort(
    (a, b) =>
      a.score - b.score ||
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
