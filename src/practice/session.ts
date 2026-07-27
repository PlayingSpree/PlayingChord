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

// How long a first-try streak must run before the ✔ flash mentions it (§7.3)
// — below this it's noise, above it it's an achievement worth calling out.
export const FIRST_TRY_STREAK_DISPLAY_MIN = 10

// One recorded prompt in a session (§7.4): a self-paced Practice prompt, or a
// Song bar. Learn prompts never appear. The label is captured at
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

// The §7 end-of-session summary: prompts played, first-try successes and the
// session's time figures, all scoped to the summarized session rather than the
// lifetime records. The Report (§7.4) builds on this via practice/report.ts.
export interface SessionSummary {
  prompts: number
  firstTrySuccesses: number
  // Sum / mean over prompts that carry a time sample (Song bars excluded).
  totalTimeToCorrectMs: number
  avgTimeToCorrectMs: number | null
}

export function summarizeSession(
  events: readonly SessionEvent[],
): SessionSummary {
  let firstTrySuccesses = 0
  let totalTimeToCorrectMs = 0
  let timedCount = 0
  for (const event of events) {
    if (event.timeToCorrectMs !== null) {
      totalTimeToCorrectMs += event.timeToCorrectMs
      timedCount += 1
    }
    firstTrySuccesses += event.outcome === 'first-try' ? 1 : 0
  }

  return {
    prompts: events.length,
    firstTrySuccesses,
    totalTimeToCorrectMs,
    avgTimeToCorrectMs:
      timedCount > 0 ? totalTimeToCorrectMs / timedCount : null,
  }
}
