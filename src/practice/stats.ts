// Per-combo stat records (DESIGN.md §8) and the recent-outcome view feeding
// the §5 miss weighting. Pure record types + update logic live here; the
// in-memory source serves tests, the persisted one (Phase 6) lives in
// storage/ behind the same interface.

import { comboKey, parseComboKey, type Combo } from './combos'
import type { VoicingLibrary } from '../theory'

export type PromptOutcome = 'first-try' | 'missed'

// How many most-recent prompt outcomes per combo feed the miss rate — also
// the most outcomes ever persisted per combo, so accuracy can't recover a
// wider window than this. A multiple of 5 keeps every grade cut (§7.5:
// .2/.4/.6/.8) landing exactly on a bucket of the window, so the letters
// never turn on a rounding edge; 10 buys two misses per letter band, which is
// what stops one rep from flipping a grade.
export const RECENT_OUTCOME_WINDOW = 10

// The window an accuracy is divided by even when fewer outcomes exist, so a
// combo with almost no history reads as unproven rather than as flawless or
// hopeless (§5). Missing evidence counts against the combo: one clean rep
// scores 1/5, not 1/1 — an S has to be earned across a run, and a single
// miss can't drop a chord to a red F it hasn't had the chance to disprove.
// Half the window, the same shape as RECENT_TIME_WINDOW.
//
// 5 is also where IMPROVED_MIN_ATTEMPTS gates the §7.3 grade-up toast, so a
// combo is proven exactly when it becomes eligible to announce a climb —
// deliberate, and worth keeping in step if either moves.
export const GRADE_EVIDENCE_FLOOR = RECENT_OUTCOME_WINDOW / 2

// How many time-to-correct samples are kept per combo — enough for a stable
// per-combo average without letting persisted records grow unbounded.
export const TIME_TO_CORRECT_SAMPLE_CAP = 20

// How many of those samples count as "recent" for the §7 chord stats page's
// recent-average time-to-correct. Its own constant rather than a reuse of
// RECENT_OUTCOME_WINDOW — the two happen to be equal, but they answer to
// different caps (outcomes are capped by their own window, time samples by
// TIME_TO_CORRECT_SAMPLE_CAP) and would move independently.
export const RECENT_TIME_WINDOW = TIME_TO_CORRECT_SAMPLE_CAP / 2

// Every recorded time-to-correct is clamped here (§6.2). A prompt left sitting
// — a pause to think, a distraction, a walk away from the keyboard — is not a
// 47-second recall, and without a ceiling one of them drags the combo's recent
// average, and so its weighting and grade, for the whole window after. It sits
// well above the §7.3 slow bar (SLOW_TIME_MS below), so a clamped rep is always
// already flagged slow; the ceiling only decides how far past counts.
export const MAX_TIME_TO_CORRECT_MS = 10_000

// One stat record per combo (§8), keyed by comboKey. `attempts` counts
// completed prompts; time-to-correct is prompt shown →
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
  // window (RECENT_TIME_WINDOW). Null when every sample is a Song-mode bar,
  // or there's no time history yet.
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

// How a completed prompt enters the *grade* window (§7.5), as opposed to how
// it is otherwise recorded. A rep that ran all the way into the §6.2 recording
// ceiling grades as a miss even when the right keys eventually went down: ten
// seconds of hunting is not recall, and letting it through as a first-try
// success meant the accuracy axis read flawless while only the speed axis —
// already at zero there — disagreed. It is the grade alone that demotes it;
// the prompt still counts as a first-try success everywhere the player is
// simply told what happened (lifetime accuracy, the session tallies and their
// grade, the Report log, the daily figures, the §7.3 streak), because they did
// play it correctly on the first attempt. Clamped times arrive exactly at the
// ceiling, so the comparison is `>=`; a null time is a clock-paced Song bar
// (§6.5), which has no span to judge.
export function gradingOutcome(
  outcome: PromptOutcome,
  timeToCorrectMs: number | null,
): PromptOutcome {
  if (outcome === 'missed') return 'missed'
  return timeToCorrectMs !== null && timeToCorrectMs >= MAX_TIME_TO_CORRECT_MS
    ? 'missed'
    : 'first-try'
}

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
    // The window the grade reads is the one place a ceiling rep is demoted
    // (gradingOutcome); the lifetime counters above keep what was played.
    recentOutcomes: [
      ...base.recentOutcomes,
      gradingOutcome(outcome, timeToCorrectMs),
    ].slice(-RECENT_OUTCOME_WINDOW),
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

export type ComboGrade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F'

// The grade is defined by its two axes in the units the player actually reads,
// rather than by a curve that happens to produce letters (§7.5). Both axes step
// one letter at a time, which is the whole trick: a second costs a letter, and
// so does a miss.
//
// Accuracy: the recent window is RECENT_OUTCOME_WINDOW = 10 outcomes, and the
// evenly spaced cut points land on its buckets two at a time — 10/10 → S, 8/10
// → A, 6/10 → B, 4/10 → C, 2/10 → D, 0/10 → F — so a single rep never flips a
// letter on its own. Since the score multiplies the two axes, accuracy alone
// caps the letter: one miss in the window can't grade S however fast it was.
// S's cut is a full 1 because S's second is where the speed ramp reaches full
// credit — so an S means flawless *and* fast, and a timeless-but-clean combo
// (no time data) sits at that same 1, neither penalized nor favored by §5
// weighting. A combo short of GRADE_EVIDENCE_FLOOR reps can't reach the top of
// the scale at all: its unplayed reps divide into the accuracy as misses.
const GRADE_MIN_SCORE: Record<Exclude<ComboGrade, 'F'>, number> = {
  S: 1,
  A: 0.8,
  B: 0.6,
  C: 0.4,
  D: 0.2,
}

// Speed: at flawless recent accuracy the letters land on round seconds — S at
// or under 1 s, A 2 s, B 3 s, C 4 s, D 5 s, F beyond. "S is a second, A is two"
// is a target a player can hold in their head mid-session; a decay curve's
// boundaries (A below 2.2 s, F past 5.7 s…) are not.
export const GRADE_TIME_MS: Record<Exclude<ComboGrade, 'F'>, number> = {
  S: 1000,
  A: 2000,
  B: 3000,
  C: 4000,
  D: 5000,
}

// Those two axes pinned together: the speed factor is the piecewise-linear
// ramp through the letter cut points, so at accuracy 1 the score crosses each
// threshold exactly at that letter's second. At or under S's second it is full
// credit — faster is never a bonus, which is what keeps a well-drilled combo
// from out-weighing an untouched one in §5 generation; past D's it runs down to
// zero at the §6.2 recording ceiling, as slow as a recorded time can be.
const SPEED_ANCHORS: readonly (readonly [number, number])[] = [
  [GRADE_TIME_MS.S, GRADE_MIN_SCORE.S],
  [GRADE_TIME_MS.A, GRADE_MIN_SCORE.A],
  [GRADE_TIME_MS.B, GRADE_MIN_SCORE.B],
  [GRADE_TIME_MS.C, GRADE_MIN_SCORE.C],
  [GRADE_TIME_MS.D, GRADE_MIN_SCORE.D],
  [MAX_TIME_TO_CORRECT_MS, 0],
]

function speedFactor(avgTimeToCorrectMs: number): number {
  const t = Math.min(
    Math.max(avgTimeToCorrectMs, 0),
    MAX_TIME_TO_CORRECT_MS, // recorded times are clamped here too (§6.2)
  )
  let fromMs = 0
  let fromFactor = 1
  for (const [ms, factor] of SPEED_ANCHORS) {
    if (t <= ms) {
      const span = ms - fromMs
      return fromFactor + ((factor - fromFactor) * (t - fromMs)) / span
    }
    fromMs = ms
    fromFactor = factor
  }
  return 0 // unreachable: t is clamped to the last anchor
}

// The proficiency score behind both §5 prioritization and the §7 chord stats
// grade: recent accuracy scaled by the speed ramp above. Multiplicative, not
// averaged, so being fast can't offset being wrong or vice versa — which is also
// what makes the letter fit to gate §5.1's pass. No time data (Song-mode-only combos, or no
// history at all) gets full speed credit — never penalize for data that isn't
// there.
function scoreOf(accuracy: number, avgTimeToCorrectMs: number | null): number {
  return (
    accuracy *
    (avgTimeToCorrectMs === null ? 1 : speedFactor(avgTimeToCorrectMs))
  )
}

// A combo with no recent history at all scores at the uniform baseline (1),
// same as comboWeight's old no-history case — an untouched combo is neither
// penalized nor favored, since §5 has nothing to go on yet.
//
// Once there *is* history the divisor is GRADE_EVIDENCE_FLOOR until the window
// fills that far, so the missing reps count as misses. One clean rep is 1/5,
// not a flawless 1/1: without this, the first outcome on a combo decided its
// whole letter — a lone miss read F and a lone lucky rep read S *and passed
// the chord* (§5.1), which is the bar 9.2.0 was trying to raise.
export function comboScore(history: ComboRecentHistory | null): number {
  if (history === null || history.total === 0) return 1
  return scoreOf(recentAccuracyOf(history), history.avgTimeToCorrectMs)
}

// (total − misses) / divisor, not 1 − misses/divisor: the cut points sit
// exactly on the window's buckets, and the latter lands a hair under them.
function recentAccuracyOf(history: ComboRecentHistory): number {
  return (
    (history.total - history.misses) /
    Math.max(history.total, GRADE_EVIDENCE_FLOOR)
  )
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

// Letter tiers over comboScore for the §7 chord stats page — a compact,
// sortable read on "how's this combo doing" that folds accuracy and speed
// into one glance.
export function comboGrade(score: number): ComboGrade {
  if (score >= GRADE_MIN_SCORE.S) return 'S'
  if (score >= GRADE_MIN_SCORE.A) return 'A'
  if (score >= GRADE_MIN_SCORE.B) return 'B'
  if (score >= GRADE_MIN_SCORE.C) return 'C'
  if (score >= GRADE_MIN_SCORE.D) return 'D'
  return 'F'
}

// The §7.3 slow bar: D's second, the last one that still grades. A rep past it,
// repeated, grades the combo F on speed alone — so the in-the-moment chip and
// the letter can't drift apart, and the chip's threshold is a number the player
// already knows from the grade.
export const SLOW_TIME_MS = GRADE_TIME_MS.D

// The §7.3 fast bar, the same idea from the other end: A's second, the tightest
// letter short of S. A rep at or under it is the speed a combo needs to sustain
// to grade A — so the `· fast` chip means "that one was A pace", not a number
// invented for the chip.
export const FAST_TIME_MS = GRADE_TIME_MS.A

// Grades worst-to-best, so "went up" is a comparison rather than string
// trivia — what the §7.3 grade-up toast tests.
export const COMBO_GRADE_ORDER: readonly ComboGrade[] = [
  'F',
  'D',
  'C',
  'B',
  'A',
  'S',
]

export function gradeRank(grade: ComboGrade): number {
  return COMBO_GRADE_ORDER.indexOf(grade)
}

// The §5.1 pass bar, stated in the letters the player already reads: a chord is
// learned once its grade reaches D — every letter but F. F is the one grade that
// isn't a grade at all (below D's second at flawless accuracy, or missing more
// than it lands), so "learned" is "no longer failing it", and the same window of
// recent reps that letters the chord on Home decides whether it passes.
export const PASS_MIN_GRADE: ComboGrade = 'D'

export function isPassingGrade(grade: ComboGrade | null): boolean {
  return grade !== null && gradeRank(grade) >= gradeRank(PASS_MIN_GRADE)
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
// the full stored history; the recent ones use RECENT_OUTCOME_WINDOW and
// RECENT_TIME_WINDOW, which are both 10 but capped independently (see the
// constants above).
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
  const score = comboScore(recent)
  return {
    attempts: record.attempts,
    lifetimeAccuracy: record.firstTrySuccesses / record.attempts,
    // The plain ratio over the reps actually played, *not* the floored one
    // the score uses: a combo that has gone 2-for-2 really is at 100%, even
    // though it grades D until there's more of a window to read.
    recentAccuracy: recent === null ? 1 : 1 - recent.misses / recent.total,
    lifetimeAvgTimeToCorrectMs: average(record.timeToCorrectMs),
    recentAvgTimeToCorrectMs:
      recent === null ? null : recent.avgTimeToCorrectMs,
    score,
    grade: comboGrade(score),
  }
}

// Has this combo enough recent outcomes for its letter to mean anything
// (§7.5)? Below the floor an F is arithmetic, not a verdict — the missing
// reps are what produced it.
function isProven(record: ComboStatRecord): boolean {
  const recent = recentHistoryOf(record)
  return recent !== null && recent.total >= GRADE_EVIDENCE_FLOOR
}

// The grade as shown (§7.5). `new` stands in for an F a combo hasn't had the
// chance to disprove yet — everything else shows its letter, including a
// below-floor D, because passing is its own proof (§5.1) and the `★ learned`
// pill must never contradict the badge beside it. Display only: comboScore
// still returns the floored number, so §5 weighting keeps drilling the combo
// and the pass gate keeps seeing the real letter.
export type DisplayGrade = ComboGrade | 'new'

export function displayGrade(record: ComboStatRecord): DisplayGrade {
  const { grade } = comboMetrics(record)
  return grade === 'F' && !isProven(record) ? 'new' : grade
}

// The same rule folded over a chord's combos for Home's In play row (§7.1):
// `new` only when nothing proven is failing. A chord with one proven F still
// reads F however many unproven combos sit beside it.
export function worstChordDisplayGrade(
  records: readonly ComboStatRecord[],
): DisplayGrade | null {
  const worst = worstChordGrade(records)
  if (worst !== 'F') return worst
  return records.some((record) => displayGrade(record) === 'F') ? 'F' : 'new'
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
