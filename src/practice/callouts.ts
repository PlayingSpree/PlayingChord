// What the ✔ flash says about the rep it belongs to (DESIGN.md §7.3, §5.4).
//
// The awkward part this module exists to hold: outcomes are recorded on
// *advance*, by which time the flash is already gone, so every callout has to
// be decided on the judgment edge instead — against a record that hasn't been
// written yet. Projecting that record here, from the same inputs the recording
// path uses, is what keeps the pill and the stats from disagreeing.
//
// Pure: a mode, a pool, the stat sources and the loop's selection go in;
// booleans and a candidate climb come out. Nothing here writes. In particular
// the once-per-session dedup of a climb is not here — whether a climb is
// *evidence-worthy* is about the rep, whether it has already been said is about
// the session, and SessionRun owns that.

import { comboKey, type Combo } from './combos'
import type { Pool } from './pool'
import { isChordInLearning, poolChordKey } from './progress'
import { MODE_POLICY, type SessionMode } from './session'
import {
  applyOutcome,
  comboMetrics,
  gradeRank,
  IMPROVED_MIN_ATTEMPTS,
  isPassingGrade,
  MAX_TIME_TO_CORRECT_MS,
  type ComboGrade,
  type ComboStatRecord,
  type ComboStatsSource,
  type PromptOutcome,
} from './stats'

// A judged attempt, reduced to what any record of it needs (§6.2): missed if it
// took more than one try, and the time clamped at the ceiling. One place, so
// the rep the ✔ pill projects and the rep recordOutcome writes can't drift —
// they are the same two lines a window apart otherwise. A rep at the ceiling is
// demoted for grading only, inside applyOutcome.
export function repOutcome(state: {
  missCount: number
  reactionMs: number | null
}): { outcome: PromptOutcome; timeToCorrectMs: number } {
  return {
    outcome: state.missCount > 0 ? 'missed' : 'first-try',
    timeToCorrectMs: Math.min(state.reactionMs ?? 0, MAX_TIME_TO_CORRECT_MS),
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

export interface Callouts {
  // This rep took a chord that was still being learned (§5.1: unlocked, not
  // yet passed) to a passing grade.
  justLearned: boolean
  // This rep took a *selected* learn-loop chord to the pass bar (§5.4).
  justRehearsed: boolean
  // This combo climbed a letter, on enough evidence to mean it (§7.3).
  climb: Climb | null
}

const NOTHING: Callouts = {
  justLearned: false,
  justRehearsed: false,
  climb: null,
}

export interface CalloutContext {
  mode: SessionMode
  // The combo on screen, or null when no prompt is in flight.
  combo: Combo | null
  pool: Pool
  // The persisted per-combo records, and the learn loop's session-local ones
  // (§5.4). Which of the two a mode's reps land in is the policy's business, so
  // both come in and the choice is made here.
  stats: ComboStatsSource
  learnStats: ComboStatsSource
  learnSelection: readonly string[]
  // Selected chords already at the bar — a chord is rehearsed once, however
  // many reps follow.
  learnRehearsed: ReadonlySet<string>
}

// The rep as it will be recorded, one advance window early.
interface ProjectedRep {
  key: string
  combo: Combo
  source: ComboStatsSource
  before: ComboStatRecord | null
  record: ComboStatRecord
}

function project(
  state: { missCount: number; reactionMs: number | null },
  ctx: CalloutContext,
): ProjectedRep | null {
  if (ctx.combo === null) return null
  // Song bars never reach the attempt machine (§6.5), so they have no
  // self-paced rep to project. Learn does project — against its own stats, for
  // its own callout (§5.4).
  const statsSource = MODE_POLICY[ctx.mode].statsSource
  if (statsSource === null) return null
  const source = statsSource === 'session' ? ctx.learnStats : ctx.stats
  const key = comboKey(ctx.combo)
  const before = source.get(key)
  const { outcome, timeToCorrectMs } = repOutcome(state)
  return {
    key,
    combo: ctx.combo,
    source,
    before,
    record: applyOutcome(before, outcome, timeToCorrectMs),
  }
}

// The §7.3 `learned` callout: the same chord grade the unlock path will read,
// over the same records, with this rep projected in. Daily practice passes
// nothing (it draws from every preset at once, §5.3), so it never claims to —
// the same chord can sit unlocked-but-unpassed in the *selected* preset while
// being learned in another, and the pill would otherwise announce a pass that
// never lands.
function judgeLearned(rep: ProjectedRep, ctx: CalloutContext): boolean {
  if (!MODE_POLICY[ctx.mode].announcesLearned) return false
  const chordKey = poolChordKey(rep.combo)
  const { chordOrder, progressRecord } = ctx.pool
  if (!isChordInLearning(chordOrder, progressRecord, chordKey)) return false
  return isPassingGrade(
    ctx.pool.chordGrade(chordKey, {
      source: rep.source,
      projected: { key: rep.key, record: rep.record },
    }),
  )
}

// The §5.4 `✓ rehearsed` callout: this rep took a *selected* chord that wasn't
// there yet to the pass bar, judged on the loop's own stats with the rep
// projected in — the same call the loop's own progress will make once it lands.
// Filler chords never earn it; nothing about them is the point.
function judgeRehearsed(rep: ProjectedRep, ctx: CalloutContext): boolean {
  if (!MODE_POLICY[ctx.mode].announcesRehearsed) return false
  const chordKey = poolChordKey(rep.combo)
  if (!ctx.learnSelection.includes(chordKey)) return false
  if (ctx.learnRehearsed.has(chordKey)) return false
  return isPassingGrade(
    ctx.pool.chordGrade(chordKey, {
      source: rep.source,
      projected: { key: rep.key, record: rep.record },
    }),
  )
}

// The §7.3 grade-up chip. Both grades must rest on at least the most-improved
// evidence floor — below that a letter swings on one rep and the notice is
// noise. Practice only: Learn's letters are session-local (§5.4), and a chip
// announcing a climb that no record will hold would be a lie.
function judgeClimb(rep: ProjectedRep, ctx: CalloutContext): Climb | null {
  if (!MODE_POLICY[ctx.mode].announcesGradeUp) return null
  if (rep.before === null || rep.before.attempts < IMPROVED_MIN_ATTEMPTS) {
    return null
  }
  const from = comboMetrics(rep.before).grade
  const to = comboMetrics(rep.record).grade
  if (gradeRank(to) <= gradeRank(from)) return null
  return { key: rep.key, label: ctx.pool.comboLabel(rep.combo), from, to }
}

// Everything the ✔ pill has to say about this rep. Decided together because
// they are decided at the same instant, from the same projection.
export function judgeCallouts(
  state: { missCount: number; reactionMs: number | null },
  ctx: CalloutContext,
): Callouts {
  const rep = project(state, ctx)
  if (rep === null) return NOTHING
  return {
    justLearned: judgeLearned(rep, ctx),
    justRehearsed: judgeRehearsed(rep, ctx),
    climb: judgeClimb(rep, ctx),
  }
}

// The §7.3 combo streak, driven by the judgment edges rather than by the
// completed prompt: a miss drops it the moment the ✘ lands, and a first-try ✔
// counts itself. Waiting for the auto-advance instead left the ✔ flash of a
// missed prompt claiming a streak the miss had already ended — and made a
// *surviving* streak undercount by one, so "🔥 10 combo" appeared on the 11th.
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
