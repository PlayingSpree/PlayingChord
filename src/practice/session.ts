import type { PromptOutcome } from './stats'

// Session modes (DESIGN.md §7): Learn shows the example voicing from the
// start and is stats-neutral — completed prompts feed neither the per-combo
// records nor the session tallies (§5), though active minutes still count.
// Practice (the default) hides the voicing and records everything. Song
// (§6.5) is clock-paced: a looped diatonic progression judged per bar.
export type SessionMode = 'learn' | 'practice' | 'song'

// Practice-mode session timer choices (§7); "custom" adds a free minutes
// input in the UI on top of these.
export const TIMER_PRESET_MINUTES: readonly number[] = [5, 10, 15]

export const MAX_TIMER_MINUTES = 180

export function sanitizeTimerMinutes(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  return Math.min(Math.round(value), MAX_TIMER_MINUTES)
}

// One completed Practice-mode prompt (skips and Learn prompts never appear).
// The label is captured at completion time so the summary doesn't need the
// preset's spelling context later.
export interface SessionEvent {
  key: string
  label: string
  outcome: PromptOutcome
  timeToCorrectMs: number
}

export interface SummaryChordEntry {
  key: string
  label: string
  prompts: number
  // First-try accuracy within the session, same definition as the stats bar.
  accuracy: number
  avgTimeToCorrectMs: number
}

// The §7 end-of-session summary: prompts played, accuracy, slowest/worst
// chords — all scoped to the summarized session, not lifetime records.
export interface SessionSummary {
  prompts: number
  firstTrySuccesses: number
  totalTimeToCorrectMs: number
  // The fastest chord's per-chord average time-to-correct — not the single
  // fastest raw sample, so one lucky rep on an easy chord can't win "best".
  bestAvgTimeToCorrectMs: number | null
  slowest: SummaryChordEntry[]
  worst: SummaryChordEntry[]
}

export const SUMMARY_CHORDS_LIMIT = 3

export function summarizeSession(
  events: readonly SessionEvent[],
): SessionSummary {
  const byKey = new Map<
    string,
    { label: string; prompts: number; firstTry: number; totalMs: number }
  >()
  let firstTrySuccesses = 0
  let totalTimeToCorrectMs = 0
  for (const event of events) {
    const entry = byKey.get(event.key) ?? {
      label: event.label,
      prompts: 0,
      firstTry: 0,
      totalMs: 0,
    }
    entry.prompts += 1
    entry.firstTry += event.outcome === 'first-try' ? 1 : 0
    entry.totalMs += event.timeToCorrectMs
    byKey.set(event.key, entry)
    firstTrySuccesses += event.outcome === 'first-try' ? 1 : 0
    totalTimeToCorrectMs += event.timeToCorrectMs
  }

  const entries: SummaryChordEntry[] = [...byKey.entries()].map(([key, e]) => ({
    key,
    label: e.label,
    prompts: e.prompts,
    accuracy: e.firstTry / e.prompts,
    avgTimeToCorrectMs: e.totalMs / e.prompts,
  }))

  const slowest = [...entries].sort(
    (a, b) =>
      b.avgTimeToCorrectMs - a.avgTimeToCorrectMs || a.key.localeCompare(b.key),
  )
  // "Worst" implies a miss somewhere (same stance as rankWorstCombos).
  const worst = entries
    .filter((e) => e.accuracy < 1)
    .sort(
      (a, b) =>
        a.accuracy - b.accuracy ||
        b.prompts - a.prompts ||
        a.key.localeCompare(b.key),
    )

  const bestAvgTimeToCorrectMs =
    entries.length > 0
      ? Math.min(...entries.map((e) => e.avgTimeToCorrectMs))
      : null

  return {
    prompts: events.length,
    firstTrySuccesses,
    totalTimeToCorrectMs,
    bestAvgTimeToCorrectMs,
    slowest: slowest.slice(0, SUMMARY_CHORDS_LIMIT),
    worst: worst.slice(0, SUMMARY_CHORDS_LIMIT),
  }
}
