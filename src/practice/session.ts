import type { PromptOutcome } from './stats'

// Session modes (DESIGN.md §7): Learn shows the example voicing from the
// start and is stats-neutral — completed prompts feed neither the per-combo
// records nor the session tallies (§5), though active minutes still count.
// The two practice modes hide the voicing and record everything: **daily**
// drills every chord already learned, across every preset, under a time cap
// (§5.3), and **free** is the configured drill — a preset, its unlock gate and
// its narrows, at whatever length was picked (§7.2). Song (§6.5) is
// clock-paced: a looped diatonic progression judged per bar.
export type SessionMode = 'learn' | 'daily' | 'free' | 'song'

// The self-paced modes that record outcomes (§5): both practice modes, and
// neither Learn (stats-neutral) nor Song (clock-paced, judged per bar). What
// the ready gate, the per-combo records and the ✔ callouts all key off.
export function isPracticeMode(mode: SessionMode): boolean {
  return mode === 'daily' || mode === 'free'
}

// Session length (§7.2) is a count of **prompts** or of **active minutes** —
// the same minutes the daily goal measures (§7.6), so a session that is only
// half played out doesn't run out while nobody is at the keyboard. `null` is
// unlimited (∞) either way. Session-only (resets on reload), applies to Learn
// and free practice; Song ignores it (it runs until ended) and daily practice
// takes its cap from the persisted setting instead (§5.3).
export type SessionLengthUnit = 'prompts' | 'minutes'

export interface SessionLength {
  unit: SessionLengthUnit
  value: number | null
}

export const SESSION_PROMPT_LENGTHS: readonly number[] = [10, 20, 40]
export const SESSION_MINUTE_LENGTHS: readonly number[] = [5, 10, 15]

export const DEFAULT_SESSION_LENGTH: SessionLength = {
  unit: 'prompts',
  value: 20,
}

export function sanitizeSessionLength(value: unknown): SessionLength {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_SESSION_LENGTH
  }
  const raw = value as { unit?: unknown; value?: unknown }
  const unit: SessionLengthUnit = raw.unit === 'minutes' ? 'minutes' : 'prompts'
  if (raw.value === null) return { unit, value: null } // ∞
  if (
    typeof raw.value !== 'number' ||
    !Number.isFinite(raw.value) ||
    raw.value <= 0
  ) {
    return { unit, value: DEFAULT_SESSION_LENGTH.value }
  }
  return { unit, value: Math.round(raw.value) }
}

// Has a session reached its length? Asked between prompts, never mid-attempt
// (§7.2), so a timed session always finishes the rep on screen.
export function sessionLengthReached(
  length: SessionLength,
  done: number,
  activeMs: number,
): boolean {
  if (length.value === null) return false
  return length.unit === 'prompts'
    ? done >= length.value
    : activeMs >= length.value * 60_000
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
