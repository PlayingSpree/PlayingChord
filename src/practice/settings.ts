import type { MatchSettings } from '../theory'

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
}

export const DEFAULT_PRACTICE_SETTINGS: PracticeSettings = {
  allowOctaveDoubling: true,
  strictExtraNotes: true,
  judgmentDelayMs: 500,
  autoAdvanceMs: 800,
}

export const MAX_DELAY_MS = 10_000

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asDelayMs(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.round(Math.min(Math.max(value, 0), MAX_DELAY_MS))
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
  }
}
