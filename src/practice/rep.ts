// A rep, completed (DESIGN.md §3, §6.2, §7.3): one prompt from shown to its ✔.
//
// The ✔ is the moment everything about the rep is decided *and* recorded — the
// flash, the per-combo record, the pass it may earn, the Report's log line — so
// what the pill says is read back from what was written, never predicted ahead
// of it. That is this module's whole job: one call on the judgment edge that
// writes the rep where the mode puts it and returns everything the store and
// the pill need to know about it.
//
// It writes only the combo record, through whichever stat source the mode's
// reps land in (§5.4). The unlock progress, the Report log and the flashes are
// returned for the store to apply: they belong to the pool and the session, and
// a value is what the tests read.

import { comboKey, type Combo } from './combos'
import type { Pool } from './pool'
import { poolChordKey } from './progress'
import { MODE_POLICY, type SessionEvent, type SessionMode } from './session'
import {
  comboMetrics,
  fastTimeMs,
  gradeRank,
  gradeScaleOf,
  IMPROVED_MIN_ATTEMPTS,
  isPassingGrade,
  maxTimeToCorrectMs,
  slowTimeMs,
  type ComboGrade,
  type ComboStatRecord,
  type ComboStatsSource,
  type PromptOutcome,
} from './stats'

// A judged attempt, reduced to what any record of it needs (§6.2): missed if it
// took more than one try, and the time clamped at the combo's own ceiling
// (§3.6). A rep at the ceiling is demoted for grading only, inside applyOutcome.
export function repOutcome(
  state: { missCount: number; reactionMs: number | null },
  gradeScale: number,
): { outcome: PromptOutcome; timeToCorrectMs: number } {
  return {
    outcome: state.missCount > 0 ? 'missed' : 'first-try',
    timeToCorrectMs: Math.min(
      state.reactionMs ?? 0,
      maxTimeToCorrectMs(gradeScale),
    ),
  }
}

// A combo whose grade just improved mid-session (§7.3): the label it's known by
// in the chord stats, and the two letters, for the line under the ✔ pill.
export interface GradeUpFlash {
  label: string
  from: ComboGrade
  to: ComboGrade
}

// A climb before the session has been asked whether it already said it — the
// combo key is what that question is keyed by.
export interface Climb extends GradeUpFlash {
  key: string
}

// The ✔ pill's speed report (§7.3), in the prompt's own grade seconds (§3.6).
export interface RepPace {
  // What was recorded: the reaction time, clamped at the ceiling (§6.2), so the
  // number the player sees is the number their stats moved by.
  timeToCorrectMs: number
  // The reaction ran past the ceiling — the pill shows the clamp as `+`.
  capped: boolean
  // Past the D/F speed boundary (§7.5) — the rep would grade F on speed alone.
  slow: boolean
  // At or under A's second — the rep was A pace.
  fast: boolean
}

// The pool after a rep that passed its item (§5.1).
export interface RepProgress {
  pool: Pool
  // The item this rep passed.
  passed: string
  // Items the pass opened by completing the unlocked batch, in unlock order;
  // empty when others in the batch are still outstanding.
  opened: readonly string[]
}

export interface RepResult {
  // The Report's log line (§7.4). Null for a learn-loop rep, which lands in the
  // loop's own stats and nowhere the session reports on (§5.4).
  event: SessionEvent | null
  // Non-null when the rep passed its item (§5.1) — only in a mode that moves
  // the unlock queue. For the store to persist; nothing here has.
  progress: RepProgress | null
  // The pass is announced on the pill (§7.3).
  justPassed: boolean
  // This rep took a *selected* learn-loop item to the pass bar (§5.4).
  justRehearsed: boolean
  // This combo climbed a letter on enough evidence to mean it (§7.3). Whether
  // it has already been said this session is SessionRun's question.
  climb: Climb | null
  pace: RepPace
}

export interface RepContext {
  mode: SessionMode
  pool: Pool
  // The persisted per-combo records, and the learn loop's session-local ones
  // (§5.4). Which of the two a mode's reps land in is the policy's business, so
  // both come in and the choice is made here.
  stats: ComboStatsSource
  learnStats: ComboStatsSource
  learnSelection: readonly string[]
  // Selected items already at the bar — an item is rehearsed once, however many
  // reps follow.
  learnRehearsed: ReadonlySet<string>
}

// Record the rep on its ✔ and say what it did. Called once per prompt, on the
// judgment edge into 'advancing'.
export function completeRep(
  state: { missCount: number; reactionMs: number | null },
  combo: Combo,
  ctx: RepContext,
): RepResult {
  const policy = MODE_POLICY[ctx.mode]
  // Song bars never reach the attempt machine (§6.5): they are judged on the
  // clock and recorded through their own path.
  if (policy.statsSource === null) {
    throw new Error(`A ${ctx.mode} bar is not a rep`)
  }
  const source = policy.statsSource === 'session' ? ctx.learnStats : ctx.stats
  const key = comboKey(combo)
  const gradeScale = gradeScaleOf(key)
  const { outcome, timeToCorrectMs } = repOutcome(state, gradeScale)

  const before = source.get(key)
  source.record(key, outcome, timeToCorrectMs)
  const after = source.get(key)

  const chordKey = poolChordKey(combo)
  const progress = policy.movesUnlockProgress
    ? passOf(chordKey, ctx.pool, source)
    : null
  const reactionMs = state.reactionMs ?? 0

  return {
    event:
      policy.statsSource === 'persisted'
        ? { key, label: ctx.pool.comboLabel(combo), outcome, timeToCorrectMs }
        : null,
    progress,
    justPassed: policy.announcesPassed && progress !== null,
    justRehearsed:
      policy.announcesRehearsed &&
      ctx.learnSelection.includes(chordKey) &&
      !ctx.learnRehearsed.has(chordKey) &&
      isPassingGrade(ctx.pool.chordGrade(chordKey, source)),
    climb: policy.announcesGradeUp
      ? climbOf(key, before, after, gradeScale, ctx.pool.comboLabel(combo))
      : null,
    pace: {
      timeToCorrectMs,
      capped: timeToCorrectMs < reactionMs,
      slow: policy.graded && reactionMs > slowTimeMs(gradeScale),
      fast: policy.graded && reactionMs <= fastTimeMs(gradeScale),
    },
  }
}

// The §5.1 pass: the item's grade — its worst combo's, this rep included — at
// the bar, while it is unlocked and not yet passed.
function passOf(
  chordKey: string,
  pool: Pool,
  source: ComboStatsSource,
): RepProgress | null {
  const next = pool.pass(chordKey, source)
  if (next === pool) return null
  return { pool: next, passed: chordKey, opened: next.openedSince(pool) }
}

// The §7.3 grade-up chip. Both grades must rest on at least the most-improved
// evidence floor — below that a letter swings on one rep and the notice is
// noise.
function climbOf(
  key: string,
  before: ComboStatRecord | null,
  after: ComboStatRecord | null,
  gradeScale: number,
  label: string,
): Climb | null {
  if (before === null || after === null) return null
  if (before.attempts < IMPROVED_MIN_ATTEMPTS) return null
  const from = comboMetrics(before, gradeScale).grade
  const to = comboMetrics(after, gradeScale).grade
  if (gradeRank(to) <= gradeRank(from)) return null
  return { key, label, from, to }
}

// The §7.3 combo streak, driven by the judgment edges rather than by the
// completed rep: a miss drops it the moment the ✘ lands, and a first-try ✔
// counts itself. It lives beside the rep because it is decided on the same
// edges, but it is not part of one — a ✘ moves it too.
//
// Returns the new count, or null when nothing changed — including a miss that
// lands on a streak already at zero, which needs no write. A reset returns 0,
// which is a count to publish and not a best streak to record.
export function streakAfter(
  prev: { missCount: number; phase: string; firstTryStreak: number },
  next: { missCount: number; phase: string },
): number | null {
  if (next.missCount > prev.missCount) {
    return prev.firstTryStreak > 0 ? 0 : null
  }
  const advanced = next.phase === 'advancing' && prev.phase !== 'advancing'
  if (advanced && next.missCount === 0) return prev.firstTryStreak + 1
  return null
}
