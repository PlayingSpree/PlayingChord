// The versioned localStorage schema (DESIGN.md §8), v1. Pure TS: types,
// defaults, and sanitizers that coerce unknown persisted data (hand-edited,
// stale, corrupted) into a valid state. Reading/writing localStorage happens
// only in localStorageAdapter.ts.

import {
  RECENT_OUTCOME_WINDOW,
  sanitizeSettings,
  TIME_TO_CORRECT_SAMPLE_CAP,
  type ComboStatRecord,
  type PracticeSettings,
  type PromptOutcome,
} from '../practice'
import type { PitchClass } from '../theory'

export const SCHEMA_VERSION = 1

// The single versioned key. The version lives *inside* the payload so
// migrations read one blob, check `version`, and upgrade in a chain.
export const STATE_STORAGE_KEY = 'playingchord:state'

export interface PersistedDevice {
  id: string
  name: string
}

export interface PersistedPresetSelection {
  presetId: string
  diatonicKey: PitchClass
}

// One row per local-timezone day (§8). Active minutes are tracked from
// Phase 7 (goals/streaks); the field is persisted from v1 so no migration
// is needed when tracking lands.
export interface DailyRecord {
  date: string // local 'YYYY-MM-DD', also the dailyRecords key
  activeMinutes: number
  prompts: number
  firstTrySuccesses: number
}

export interface PersistedStateV1 {
  version: typeof SCHEMA_VERSION
  settings: PracticeSettings
  lastMidiDevice: PersistedDevice | null
  presetSelection: PersistedPresetSelection | null
  comboStats: Record<string, ComboStatRecord>
  dailyRecords: Record<string, DailyRecord>
}

export function defaultState(): PersistedStateV1 {
  return {
    version: SCHEMA_VERSION,
    settings: sanitizeSettings(undefined),
    lastMidiDevice: null,
    presetSelection: null,
    comboStats: {},
    dailyRecords: {},
  }
}

// Local-timezone day key — daily records follow the user's clock (§7).
export function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null
}

export function sanitizeDevice(value: unknown): PersistedDevice | null {
  const raw = asRecord(value)
  if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string') {
    return null
  }
  return { id: raw.id, name: raw.name }
}

export function sanitizePresetSelection(
  value: unknown,
): PersistedPresetSelection | null {
  const raw = asRecord(value)
  if (!raw || typeof raw.presetId !== 'string') return null
  const key = asCount(raw.diatonicKey)
  if (key === null || key > 11) return null
  return { presetId: raw.presetId, diatonicKey: key as PitchClass }
}

// Invalid records are dropped whole rather than repaired: a stat record with
// garbled counts has no trustworthy part, and losing one combo's history
// only resets its weighting to baseline.
function sanitizeComboStatRecord(value: unknown): ComboStatRecord | null {
  const raw = asRecord(value)
  if (!raw) return null
  const attempts = asCount(raw.attempts)
  const firstTrySuccesses = asCount(raw.firstTrySuccesses)
  if (
    attempts === null ||
    attempts === 0 ||
    firstTrySuccesses === null ||
    firstTrySuccesses > attempts ||
    !Array.isArray(raw.recentOutcomes) ||
    !Array.isArray(raw.timeToCorrectMs)
  ) {
    return null
  }
  const recentOutcomes = raw.recentOutcomes
    .filter((o): o is PromptOutcome => o === 'first-try' || o === 'missed')
    .slice(-RECENT_OUTCOME_WINDOW)
  const timeToCorrectMs = raw.timeToCorrectMs
    .filter((t): t is number => typeof t === 'number' && Number.isFinite(t))
    .map((t) => Math.max(0, Math.round(t)))
    .slice(-TIME_TO_CORRECT_SAMPLE_CAP)
  return { attempts, firstTrySuccesses, recentOutcomes, timeToCorrectMs }
}

export function sanitizeComboStats(
  value: unknown,
): Record<string, ComboStatRecord> {
  const raw = asRecord(value)
  if (!raw) return {}
  const stats: Record<string, ComboStatRecord> = {}
  for (const [key, entry] of Object.entries(raw)) {
    const record = sanitizeComboStatRecord(entry)
    if (record) stats[key] = record
  }
  return stats
}

export function sanitizeDailyRecords(
  value: unknown,
): Record<string, DailyRecord> {
  const raw = asRecord(value)
  if (!raw) return {}
  const records: Record<string, DailyRecord> = {}
  for (const entry of Object.values(raw)) {
    const record = asRecord(entry)
    if (!record) continue
    const date = record.date
    const activeMinutes = record.activeMinutes
    const prompts = asCount(record.prompts)
    const firstTrySuccesses = asCount(record.firstTrySuccesses)
    if (
      typeof date !== 'string' ||
      !DATE_KEY_PATTERN.test(date) ||
      typeof activeMinutes !== 'number' ||
      !Number.isFinite(activeMinutes) ||
      activeMinutes < 0 ||
      prompts === null ||
      firstTrySuccesses === null ||
      firstTrySuccesses > prompts
    ) {
      continue
    }
    // The record's own date is canonical — a mismatched map key self-heals.
    records[date] = { date, activeMinutes, prompts, firstTrySuccesses }
  }
  return records
}

export function sanitizeStateV1(
  raw: Record<string, unknown>,
): PersistedStateV1 {
  return {
    version: SCHEMA_VERSION,
    settings: sanitizeSettings(raw.settings),
    lastMidiDevice: sanitizeDevice(raw.lastMidiDevice),
    presetSelection: sanitizePresetSelection(raw.presetSelection),
    comboStats: sanitizeComboStats(raw.comboStats),
    dailyRecords: sanitizeDailyRecords(raw.dailyRecords),
  }
}
