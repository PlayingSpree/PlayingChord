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
  // Correct chime (§9): on ✔, independent of the piano sound below.
  chimeEnabled: boolean
  // Piano tone on each key press (§9): voices the user's own playing,
  // velocity-sensitive — not feedback, so misses still stay visual-only.
  pianoSoundEnabled: boolean
  // Chord name display size (§7): the prompt's primary text. 'lg' matches
  // the original fixed size.
  chordNameSize: ChordNameSize
  // Unlock order (§5.1): root-ordered (product) pools unlock along the
  // circle of fifths (C → G → D …) instead of chromatically. Diatonic and
  // explicit pools keep their own deliberate order either way.
  unlockByFifths: boolean
  // Song mode (§6.5) — set beside the mode picker, not the settings panel,
  // but persisted here so tempo/length survive reloads.
  songTempoBpm: number
  songChordCount: number // 2–4 chords per progression
  songShowExample: boolean // overlay each bar's example voicing, Learn-style
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
  pianoSoundEnabled: true,
  chordNameSize: 'lg',
  unlockByFifths: false,
  songTempoBpm: 60,
  songChordCount: 4,
  songShowExample: true,
}

export const MAX_DELAY_MS = 10_000
export const MAX_DAILY_GOAL_MINUTES = 1_440 // one full day

// Song-mode tempo bounds (§6.5) and progression-length choices (§7).
export const MIN_SONG_TEMPO_BPM = 40
export const MAX_SONG_TEMPO_BPM = 140
export const SONG_CHORD_COUNTS: readonly number[] = [2, 3, 4]

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

export function sanitizeSongTempoBpm(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PRACTICE_SETTINGS.songTempoBpm
  }
  return Math.round(
    Math.min(Math.max(value, MIN_SONG_TEMPO_BPM), MAX_SONG_TEMPO_BPM),
  )
}

function asSongChordCount(value: unknown, fallback: number): number {
  return SONG_CHORD_COUNTS.includes(value as number)
    ? (value as number)
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
    pianoSoundEnabled: asBoolean(
      raw.pianoSoundEnabled,
      defaults.pianoSoundEnabled,
    ),
    chordNameSize: asChordNameSize(raw.chordNameSize, defaults.chordNameSize),
    unlockByFifths: asBoolean(raw.unlockByFifths, defaults.unlockByFifths),
    songTempoBpm: sanitizeSongTempoBpm(raw.songTempoBpm),
    songChordCount: asSongChordCount(
      raw.songChordCount,
      defaults.songChordCount,
    ),
    songShowExample: asBoolean(raw.songShowExample, defaults.songShowExample),
  }
}
