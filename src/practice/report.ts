// End-of-session Report derivations (DESIGN.md §7.4): pure TS, no DOM/MIDI.
// The store gathers the raw session inputs (recorded events, daily records,
// lifetime totals, unlock/pass tracking, goal snapshot) and this module turns
// them into the SessionReport the ReportView renders — the session grade, the
// trailing-baseline deltas, the passed / still-shaky lists.
//
// Kept free of storage/ types (the architecture rule, §8): the daily records
// are consumed structurally, so nothing here imports the persistence schema.

import {
  comboGrade,
  sessionScore,
  type ComboGrade,
  type DisplayGrade,
} from './stats'
import {
  summarizeSession,
  type SessionEvent,
  type SessionMode,
} from './session'

// The Report's stat deltas compare against the mean over the last N practiced
// days (§7.4).
export const BASELINE_DAYS = 30

// The subset of a daily record the baseline reads — a structural shape so
// storage's DailyRecord (which has more fields) is assignable without this
// module depending on storage/.
export interface DailyStatsForBaseline {
  prompts: number
  firstTrySuccesses: number
  // Prompts carrying a time sample — Song bars excluded (§6.5). The divisor
  // for timeToCorrectMs; can be 0 on a Song-only day.
  timedPrompts: number
  timeToCorrectMs: number
}

export interface ReportBaseline {
  accuracy: number | null
  avgTimeMs: number | null
}

// The unlock banner (§7.4): the chords opened this session and the pool's
// progress toward the next batch.
export interface ReportUnlock {
  labels: string[]
  unlocked: number
  passed: number
  total: number
}

export interface ReportGoal {
  todayMinutes: number
  streak: number
}

export interface ShakyChord {
  label: string
  misses: number
}

// One chord played this session, as the §5.2 suggestion reads it: the chord's
// *current* grade (not the session's), how often it was missed here, and
// whether setting it aside is even allowed right now (the MIN_ACTIVE_CHORDS
// floor). The store supplies these; the rule below stays pure.
export interface ReportChord {
  chordKey: string
  label: string
  grade: DisplayGrade | null
  misses: number
  canSetAside: boolean
}

// The Report's one-line offer to narrow or widen the pool by hand (§7.4/§5.2).
export interface ReportSuggestion {
  kind: 'set-aside' | 'bring-back'
  chordKey: string
  label: string
}

// Sessions at or above this grade are the ones that offer a set-aside chord
// back: the player has room again, and a benched chord gets no reps of its
// own to prove it with (nothing deals it), so the only way back is an offer.
const BRING_BACK_MIN_GRADE: readonly ComboGrade[] = ['S', 'A']

// When the Report offers to set a chord aside (§7.4). Deliberately narrow, so
// it needs no "don't show this again" memory of its own:
//
//  - Practice only. Learn is stats-neutral (§5) and Song isn't gated by
//    unlocks at all (§6.5), so setting a chord aside wouldn't change what
//    either of them deals.
//  - The *session* graded F, and
//  - some chord in it is *currently* graded F too. A session can grade F on
//    pace alone with every chord sitting at C; naming a scapegoat there would
//    be a lie. `new` is not F (§7.5) — an unproven chord needs reps, not a
//    bench.
//
// Worst first is the chord missed most this session, ties broken by label so
// the offer is stable across identical reports.
export function pickSuggestion(
  mode: SessionMode,
  grade: ComboGrade | null,
  chords: readonly ReportChord[],
  setAside: readonly { chordKey: string; label: string }[],
): ReportSuggestion | null {
  if (mode !== 'practice' || grade === null) return null
  if (grade === 'F') {
    const candidate = chords
      .filter((chord) => chord.grade === 'F' && chord.canSetAside)
      .sort((a, b) => b.misses - a.misses || a.label.localeCompare(b.label))[0]
    return candidate === undefined
      ? null
      : {
          kind: 'set-aside',
          chordKey: candidate.chordKey,
          label: candidate.label,
        }
  }
  if (!BRING_BACK_MIN_GRADE.includes(grade)) return null
  const waiting = setAside[0]
  return waiting === undefined
    ? null
    : { kind: 'bring-back', chordKey: waiting.chordKey, label: waiting.label }
}

export interface SessionReport {
  mode: SessionMode
  // Prompts advanced past this session — correct + Learn (§7.2 length
  // counts them all). The zero-prompt guard and the "prompts played" figure.
  promptsPlayed: number
  // Recorded prompts (Learn excluded) — the accuracy denominator.
  recordedPrompts: number
  // null for Learn or a session with no recorded prompts.
  accuracy: number | null
  avgTimeMs: number | null
  // null for Learn (stats-neutral, §5) — the view renders the reduced variant.
  grade: ComboGrade | null
  baseline: ReportBaseline
  lifetime: { prompts: number; activeMinutes: number }
  increment: { prompts: number; activeMinutes: number }
  passedLabels: string[]
  shaky: ShakyChord[]
  unlocked: ReportUnlock | null
  suggestion: ReportSuggestion | null
  goal: ReportGoal
}

export interface SessionReportInput {
  mode: SessionMode
  promptsPlayed: number
  events: readonly SessionEvent[]
  records: Readonly<Record<string, DailyStatsForBaseline>>
  todayKey: string
  lifetime: { prompts: number; activeMinutes: number }
  increment: { prompts: number; activeMinutes: number }
  passedLabels: readonly string[]
  unlocked: ReportUnlock | null
  // The session's chords and the preset's benched ones, for the §5.2 offer.
  chords: readonly ReportChord[]
  setAside: readonly { chordKey: string; label: string }[]
  goal: ReportGoal
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

// The trailing baseline (§7.4): the mean over the last BASELINE_DAYS days with
// ≥ 1 recorded prompt, today excluded. Accuracy and avg-time use the same
// per-day conventions the Progress trend chart does (firstTrySuccesses /
// prompts, timeToCorrectMs / timedPrompts). Null when no qualifying day
// exists — and a day of nothing but Song bars qualifies for the accuracy mean
// while sitting out the time mean, having contributed no time sample.
export function trailingBaseline(
  records: Readonly<Record<string, DailyStatsForBaseline>>,
  todayKey: string,
  days: number = BASELINE_DAYS,
): ReportBaseline {
  const qualifying = Object.entries(records)
    .filter(([date, record]) => date !== todayKey && record.prompts > 0)
    // Date keys are 'YYYY-MM-DD', so lexicographic desc is most-recent first.
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, days)
    .map(([, record]) => record)
  if (qualifying.length === 0) return { accuracy: null, avgTimeMs: null }
  const timed = qualifying.filter((r) => r.timedPrompts > 0)
  return {
    accuracy: mean(qualifying.map((r) => r.firstTrySuccesses / r.prompts)),
    avgTimeMs:
      timed.length > 0
        ? mean(timed.map((r) => r.timeToCorrectMs / r.timedPrompts))
        : null,
  }
}

export function buildSessionReport(input: SessionReportInput): SessionReport {
  const summary = summarizeSession(input.events)
  const recordedPrompts = summary.prompts
  const accuracy =
    recordedPrompts > 0 ? summary.firstTrySuccesses / recordedPrompts : null
  const avgTimeMs = summary.avgTimeToCorrectMs

  // Learn is stats-neutral (§5): no grade. Otherwise the §5 chord-score math
  // — a null avgTime (Song) gets full speed credit inside sessionScore.
  const grade =
    input.mode === 'learn' || accuracy === null
      ? null
      : comboGrade(sessionScore(accuracy, avgTimeMs))

  // Still shaky: chords with ≥ 1 missed prompt this session, most misses first.
  const missesByLabel = new Map<string, number>()
  for (const event of input.events) {
    if (event.outcome === 'missed') {
      missesByLabel.set(event.label, (missesByLabel.get(event.label) ?? 0) + 1)
    }
  }
  const shaky = [...missesByLabel.entries()]
    .map(([label, misses]) => ({ label, misses }))
    .sort((a, b) => b.misses - a.misses || a.label.localeCompare(b.label))

  return {
    mode: input.mode,
    promptsPlayed: input.promptsPlayed,
    recordedPrompts,
    accuracy,
    avgTimeMs,
    grade,
    baseline: trailingBaseline(input.records, input.todayKey),
    lifetime: input.lifetime,
    increment: input.increment,
    passedLabels: [...input.passedLabels],
    shaky,
    unlocked: input.unlocked,
    suggestion: pickSuggestion(input.mode, grade, input.chords, input.setAside),
    goal: input.goal,
  }
}
