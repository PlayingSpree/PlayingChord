// End-of-session Report derivations (DESIGN.md §7.4): pure TS, no DOM/MIDI.
// The store gathers the raw session inputs (recorded events, daily records,
// lifetime totals, unlock/pass tracking, goal snapshot) and this module turns
// them into the SessionReport the ReportView renders — the session grade, the
// trailing-baseline deltas, the passed / still-shaky lists.
//
// Kept free of storage/ types (the architecture rule, §8): the daily records
// are consumed structurally, so nothing here imports the persistence schema.

import { comboGrade, sessionScore, type ComboGrade } from './stats'
import {
  summarizeSession,
  type SessionEvent,
  type SessionMode,
  type SummaryChordEntry,
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

export interface SessionReport {
  mode: SessionMode
  // Prompts advanced past this session — correct + skip + Learn (§7.2 length
  // counts them all). The zero-prompt guard and the "prompts played" figure.
  promptsPlayed: number
  // Recorded prompts (skips & Learn excluded) — the accuracy denominator.
  recordedPrompts: number
  // null for Learn or a session with no recorded prompts (e.g. all skips).
  accuracy: number | null
  avgTimeMs: number | null
  bestAvgTimeMs: number | null
  slowest: SummaryChordEntry[]
  worst: SummaryChordEntry[]
  // null for Learn (stats-neutral, §5) — the view renders the reduced variant.
  grade: ComboGrade | null
  baseline: ReportBaseline
  lifetime: { prompts: number; activeMinutes: number }
  increment: { prompts: number; activeMinutes: number }
  passedLabels: string[]
  shaky: ShakyChord[]
  unlocked: ReportUnlock | null
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
  goal: ReportGoal
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

// The trailing baseline (§7.4): the mean over the last BASELINE_DAYS days with
// ≥ 1 recorded prompt, today excluded. Accuracy and avg-time use the same
// per-day conventions the Progress trend chart does (firstTrySuccesses /
// prompts, timeToCorrectMs / prompts). Null when no qualifying day exists.
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
  return {
    accuracy: mean(qualifying.map((r) => r.firstTrySuccesses / r.prompts)),
    avgTimeMs: mean(qualifying.map((r) => r.timeToCorrectMs / r.prompts)),
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
    bestAvgTimeMs: summary.bestAvgTimeToCorrectMs,
    slowest: summary.slowest,
    worst: summary.worst,
    grade,
    baseline: trailingBaseline(input.records, input.todayKey),
    lifetime: input.lifetime,
    increment: input.increment,
    passedLabels: [...input.passedLabels],
    shaky,
    unlocked: input.unlocked,
    goal: input.goal,
  }
}
