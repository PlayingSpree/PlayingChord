import type { MatchSettings } from '../theory'

// Chord-name display size (§7 prompt area): discrete steps rather than a
// free px value, so every size stays legible and the settings UI is a
// simple select rather than a slider.
export const CHORD_NAME_SIZES = ['sm', 'md', 'lg', 'xl'] as const
export type ChordNameSize = (typeof CHORD_NAME_SIZES)[number]

// Tunable practice behavior (DESIGN.md §6.2, §6.3): the two matcher toggles
// plus the two lifecycle delays. Lives in practice/ so the lifecycle machine
// stays pure; the store layer owns persistence (plain localStorage for now,
// migrating into the Phase 6 versioned schema).
export interface PracticeSettings extends MatchSettings {
  // Stall timer (§6.2): a full-sized, non-matching held set that hasn't
  // changed for this long latches a miss.
  judgmentDelayMs: number
  // How long the ✔ flash stays before the next prompt (§6.2).
  autoAdvanceMs: number
  // Daily active-practice goal (§7), in minutes.
  dailyGoalMinutes: number
  // Grand-staff notation (§3.4): shown whenever this is on, in both Learn
  // and Practice; off keeps name+keyboard-only practice first-class.
  staffEnabled: boolean
  // Renders the staff in the chord root's major key — key signature plus
  // diatonic respelling (§3.5) — instead of the default fixed spelling.
  staffKeyEnabled: boolean
  // Correct chime (§9): the app's only sound — misses stay silent.
  chimeEnabled: boolean
  // Chord name display size (§7): the prompt's primary text. 'lg' matches
  // the original fixed size.
  chordNameSize: ChordNameSize
}

export const DEFAULT_PRACTICE_SETTINGS: PracticeSettings = {
  allowOctaveDoubling: true,
  strictExtraNotes: true,
  judgmentDelayMs: 500,
  autoAdvanceMs: 800,
  dailyGoalMinutes: 10,
  staffEnabled: true,
  staffKeyEnabled: false,
  chimeEnabled: true,
  chordNameSize: 'lg',
}

export const MAX_DELAY_MS = 10_000
export const MAX_DAILY_GOAL_MINUTES = 1_440 // one full day

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asDelayMs(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.min(Math.max(value, 0), MAX_DELAY_MS))
}

function asGoalMinutes(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.min(Math.max(value, 1), MAX_DAILY_GOAL_MINUTES))
}

function asChordNameSize(
  value: unknown,
  fallback: ChordNameSize,
): ChordNameSize {
  return CHORD_NAME_SIZES.includes(value as ChordNameSize)
    ? (value as ChordNameSize)
    : fallback
}

// Coerces unknown data (hand-edited localStorage, stale schema, wild UI
// input) into valid settings: wrong-typed fields fall back to defaults,
// unknown fields are dropped, delays are clamped to [0, MAX_DELAY_MS].
export function sanitizeSettings(value: unknown): PracticeSettings {
  const raw: Record<string, unknown> =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {}
  const defaults = DEFAULT_PRACTICE_SETTINGS
  return {
    allowOctaveDoubling: asBoolean(
      raw.allowOctaveDoubling,
      defaults.allowOctaveDoubling,
    ),
    strictExtraNotes: asBoolean(
      raw.strictExtraNotes,
      defaults.strictExtraNotes,
    ),
    judgmentDelayMs: asDelayMs(raw.judgmentDelayMs, defaults.judgmentDelayMs),
    autoAdvanceMs: asDelayMs(raw.autoAdvanceMs, defaults.autoAdvanceMs),
    dailyGoalMinutes: asGoalMinutes(
      raw.dailyGoalMinutes,
      defaults.dailyGoalMinutes,
    ),
    staffEnabled: asBoolean(raw.staffEnabled, defaults.staffEnabled),
    staffKeyEnabled: asBoolean(raw.staffKeyEnabled, defaults.staffKeyEnabled),
    chimeEnabled: asBoolean(raw.chimeEnabled, defaults.chimeEnabled),
    chordNameSize: asChordNameSize(raw.chordNameSize, defaults.chordNameSize),
  }
}
