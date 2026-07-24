import type { PromptOutcome } from './stats'

// Session modes (DESIGN.md §7): Learn shows the example voicing from the
// start and is stats-neutral — completed prompts feed neither the per-combo
// records nor the session tallies (§5), though active minutes still count.
// Practice (the default) hides the voicing and records everything. Song
// (§6.5) is clock-paced: a looped diatonic progression judged per bar.
export type SessionMode = 'learn' | 'practice' | 'song'

// Session length is a prompt count (§7.2): reaching it ends the session and
// shows the Report. Session-only (resets on reload), applies to Learn and
// Practice; Song ignores it (it runs until ended). `null` means unlimited (∞).
export const SESSION_LENGTHS: readonly number[] = [10, 20, 40]

export const DEFAULT_SESSION_LENGTH = 20

export function sanitizeSessionLength(value: unknown): number | null {
  if (value === null) return null // ∞
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_SESSION_LENGTH
  }
  return Math.round(value)
}

// One recorded prompt in a session (§7.4): a self-paced Practice prompt, or a
// Song bar. Skips and Learn prompts never appear. The label is captured at
// completion time so the report doesn't need the preset's spelling context
// later. `timeToCorrectMs` is null for Song bars — a clock-paced bar has no
// "prompt shown → correct" span (§6.5), same convention as the per-combo
// stat records.
export interface SessionEvent {
  key: string
  label: string
  outcome: PromptOutcome
  timeToCorrectMs: number | null
}

export interface SummaryChordEntry {
  key: string
  label: string
  prompts: number
  // First-try accuracy within the session, same definition as the stats bar.
  accuracy: number
  // null when every prompt on this chord was a Song bar (no time sample).
  avgTimeToCorrectMs: number | null
}

// The §7 end-of-session summary: prompts played, accuracy, slowest/worst
// chords — all scoped to the summarized session, not lifetime records. The
// Report (§7.4) builds on this via practice/report.ts.
export interface SessionSummary {
  prompts: number
  firstTrySuccesses: number
  // Sum / mean over prompts that carry a time sample (Song bars excluded).
  totalTimeToCorrectMs: number
  avgTimeToCorrectMs: number | null
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
    {
      label: string
      prompts: number
      firstTry: number
      timedCount: number
      timedTotalMs: number
    }
  >()
  let firstTrySuccesses = 0
  let totalTimeToCorrectMs = 0
  let timedCount = 0
  for (const event of events) {
    const entry = byKey.get(event.key) ?? {
      label: event.label,
      prompts: 0,
      firstTry: 0,
      timedCount: 0,
      timedTotalMs: 0,
    }
    entry.prompts += 1
    entry.firstTry += event.outcome === 'first-try' ? 1 : 0
    if (event.timeToCorrectMs !== null) {
      entry.timedCount += 1
      entry.timedTotalMs += event.timeToCorrectMs
      totalTimeToCorrectMs += event.timeToCorrectMs
      timedCount += 1
    }
    byKey.set(event.key, entry)
    firstTrySuccesses += event.outcome === 'first-try' ? 1 : 0
  }

  const entries: SummaryChordEntry[] = [...byKey.entries()].map(([key, e]) => ({
    key,
    label: e.label,
    prompts: e.prompts,
    accuracy: e.firstTry / e.prompts,
    avgTimeToCorrectMs: e.timedCount > 0 ? e.timedTotalMs / e.timedCount : null,
  }))

  // Slowest ranks only chords with a time sample; a Song-only chord has no
  // time to be "slow".
  const timed = entries.filter(
    (e): e is SummaryChordEntry & { avgTimeToCorrectMs: number } =>
      e.avgTimeToCorrectMs !== null,
  )
  const slowest = [...timed].sort(
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
    timed.length > 0
      ? Math.min(...timed.map((e) => e.avgTimeToCorrectMs))
      : null

  return {
    prompts: events.length,
    firstTrySuccesses,
    totalTimeToCorrectMs,
    avgTimeToCorrectMs:
      timedCount > 0 ? totalTimeToCorrectMs / timedCount : null,
    bestAvgTimeToCorrectMs,
    slowest: slowest.slice(0, SUMMARY_CHORDS_LIMIT),
    worst: worst.slice(0, SUMMARY_CHORDS_LIMIT),
  }
}
