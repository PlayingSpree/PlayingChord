// The versioned localStorage schema (DESIGN.md §8), v1. Pure TS: types,
// defaults, and sanitizers that coerce unknown persisted data (hand-edited,
// stale, corrupted) into a valid state. Reading/writing localStorage happens
// only in localStorageAdapter.ts.

import {
  builtInPresets,
  EDITOR_MAX_HAND_NOTES,
  EDITOR_MAX_PATTERN_DEGREE,
  RECENT_OUTCOME_WINDOW,
  sanitizeSettings,
  TIME_TO_CORRECT_SAMPLE_CAP,
  type ChordPool,
  type ComboStatRecord,
  type PoolChord,
  type PracticeSettings,
  type Preset,
  type PromptOutcome,
} from '../practice'
import {
  BUILT_IN_VOICING_RULES,
  CHORD_TYPES,
  type BassConstraint,
  type ChordTypeId,
  type PitchClass,
  type SpanConstraint,
  type VoicingRule,
} from '../theory'

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
  // Summed per-prompt time-to-correct for the day — the §7 History trend
  // needs a per-day average, which the per-combo sample windows can't give.
  // Added within v1: absent in early-v1 states, so it defaults rather than
  // invalidating the record.
  timeToCorrectMs: number
}

export interface PersistedStateV1 {
  version: typeof SCHEMA_VERSION
  settings: PracticeSettings
  lastMidiDevice: PersistedDevice | null
  presetSelection: PersistedPresetSelection | null
  comboStats: Record<string, ComboStatRecord>
  dailyRecords: Record<string, DailyRecord>
  // The Phase 9 custom library (§4): user-built voicing rules and presets.
  // Added within v1 — the sanitizers default both to empty, so early-v1
  // states need no migration.
  customVoicingRules: VoicingRule[]
  customPresets: Preset[]
}

export function defaultState(): PersistedStateV1 {
  return {
    version: SCHEMA_VERSION,
    settings: sanitizeSettings(undefined),
    lastMidiDevice: null,
    presetSelection: null,
    comboStats: {},
    dailyRecords: {},
    customVoicingRules: [],
    customPresets: [],
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
    // Absent in early-v1 states (see DailyRecord); a bad value zeroes only
    // this metric instead of dropping the whole day.
    const timeToCorrectMs =
      typeof record.timeToCorrectMs === 'number' &&
      Number.isFinite(record.timeToCorrectMs) &&
      record.timeToCorrectMs >= 0
        ? record.timeToCorrectMs
        : 0
    // The record's own date is canonical — a mismatched map key self-heals.
    records[date] = {
      date,
      activeMinutes,
      prompts,
      firstTrySuccesses,
      timeToCorrectMs,
    }
  }
  return records
}

// ——— Custom library (Phase 9, §4) ———
//
// Like stat records, garbled entries are dropped whole: a rule or preset
// with an invalid field has no trustworthy part, and the user can rebuild
// it in the editor. Ids may never shadow a built-in.

const BUILT_IN_RULE_IDS = new Set(BUILT_IN_VOICING_RULES.map((r) => r.id))
const BUILT_IN_PRESET_IDS = new Set(builtInPresets().map((p) => p.id))
const KNOWN_CHORD_TYPE_IDS = new Set<string>(CHORD_TYPES.map((t) => t.id))

// Custom names are user-typed free text; cap so one absurd paste can't
// bloat the persisted blob.
export const MAX_LIBRARY_NAME_LENGTH = 60

// Span bounds live on an 88-key keyboard (§3.3); anything wider than the
// keyboard is meaningless.
export const MAX_SPAN_SEMITONES = 87

// Bass-degree indices only make sense within the largest built-in chord
// (dom13, 7 tones). Out-of-range degrees are merely unsatisfiable, but a
// stored rule no chord can ever satisfy is junk, not preference.
export const MAX_BASS_DEGREE = 6

function asLibraryId(
  value: unknown,
  builtIns: ReadonlySet<string>,
): string | null {
  if (typeof value !== 'string' || value === '' || builtIns.has(value)) {
    return null
  }
  return value
}

function asLibraryName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().slice(0, MAX_LIBRARY_NAME_LENGTH)
  return name === '' ? null : name
}

function asPitchClassValue(value: unknown): PitchClass | null {
  const pc = asCount(value)
  return pc === null || pc > 11 ? null : (pc as PitchClass)
}

function sanitizeBass(value: unknown): BassConstraint | null {
  const raw = asRecord(value)
  if (!raw) return null
  if (raw.kind === 'any') return { kind: 'any' }
  if (raw.kind === 'chordTone') {
    const degree = asCount(raw.degree)
    if (degree === null || degree > MAX_BASS_DEGREE) return null
    return { kind: 'chordTone', degree }
  }
  return null
}

// Returns undefined for an absent/empty span, null for a contradictory one
// (min > max) — which invalidates the whole rule.
function sanitizeSpan(value: unknown): SpanConstraint | null | undefined {
  if (value === undefined || value === null) return undefined
  const raw = asRecord(value)
  if (!raw) return undefined
  const asSemitones = (v: unknown): number | undefined => {
    const n = asCount(v)
    return n === null || n > MAX_SPAN_SEMITONES ? undefined : n
  }
  const min = asSemitones(raw.min)
  const max = asSemitones(raw.max)
  if (min === undefined && max === undefined) return undefined
  if (min !== undefined && max !== undefined && min > max) return null
  return {
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  }
}

// A hand's degree list for a pattern rule: 1..EDITOR_MAX_PATTERN_DEGREE
// integers, capped at EDITOR_MAX_HAND_NOTES (imported from practice/library
// so the builder and the sanitizer always agree on the bound). `null` on
// anything malformed; an empty array is valid (one-hand voicings).
function sanitizePatternHand(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > EDITOR_MAX_HAND_NOTES) {
    return null
  }
  const degrees: number[] = []
  for (const entry of value) {
    const degree = asCount(entry)
    if (degree === null || degree < 1 || degree > EDITOR_MAX_PATTERN_DEGREE) {
      return null
    }
    degrees.push(degree)
  }
  return degrees
}

function sanitizeCustomVoicingRule(
  value: unknown,
  seenIds: ReadonlySet<string>,
): VoicingRule | null {
  const raw = asRecord(value)
  if (!raw) return null
  const id = asLibraryId(raw.id, BUILT_IN_RULE_IDS)
  const name = asLibraryName(raw.name)
  if (id === null || seenIds.has(id) || name === null) return null

  if (raw.kind === 'pattern') {
    const leftHand = sanitizePatternHand(raw.leftHand)
    const rightHand = sanitizePatternHand(raw.rightHand)
    if (
      leftHand === null ||
      rightHand === null ||
      (leftHand.length === 0 && rightHand.length === 0)
    ) {
      return null
    }
    return { kind: 'pattern', id, name, leftHand, rightHand }
  }

  const bass = sanitizeBass(raw.bass)
  const span = sanitizeSpan(raw.span)
  if (
    bass === null ||
    span === null ||
    (raw.doubling !== 'allowed' && raw.doubling !== 'exact')
  ) {
    return null
  }
  return {
    id,
    name,
    bass,
    ...(span !== undefined ? { span } : {}),
    doubling: raw.doubling,
  }
}

export function sanitizeCustomVoicingRules(value: unknown): VoicingRule[] {
  if (!Array.isArray(value)) return []
  const rules: VoicingRule[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const rule = sanitizeCustomVoicingRule(entry, seen)
    if (rule) {
      rules.push(rule)
      seen.add(rule.id)
    }
  }
  return rules
}

function sanitizePoolChord(value: unknown): PoolChord | null {
  const raw = asRecord(value)
  if (!raw) return null
  const root = asPitchClassValue(raw.root)
  const typeId = raw.typeId
  if (root === null || typeof typeId !== 'string') return null
  if (!KNOWN_CHORD_TYPE_IDS.has(typeId)) return null
  return { root, typeId: typeId as ChordTypeId }
}

function sanitizePool(value: unknown): ChordPool | null {
  const raw = asRecord(value)
  if (!raw) return null
  switch (raw.kind) {
    case 'product': {
      if (!Array.isArray(raw.roots) || !Array.isArray(raw.chordTypes)) {
        return null
      }
      const roots = [
        ...new Set(
          raw.roots
            .map(asPitchClassValue)
            .filter((pc): pc is PitchClass => pc !== null),
        ),
      ]
      const chordTypes = [
        ...new Set(
          raw.chordTypes.filter(
            (t): t is ChordTypeId =>
              typeof t === 'string' && KNOWN_CHORD_TYPE_IDS.has(t),
          ),
        ),
      ]
      if (roots.length === 0 || chordTypes.length === 0) return null
      return { kind: 'product', roots, chordTypes }
    }
    case 'explicit': {
      if (!Array.isArray(raw.chords)) return null
      const byKey = new Map<string, PoolChord>()
      for (const entry of raw.chords) {
        const chord = sanitizePoolChord(entry)
        if (chord) byKey.set(`${chord.root}:${chord.typeId}`, chord)
      }
      if (byKey.size === 0) return null
      return { kind: 'explicit', chords: [...byKey.values()] }
    }
    case 'diatonic': {
      const key = asPitchClassValue(raw.key)
      return key === null ? null : { kind: 'diatonic', key }
    }
    default:
      return null
  }
}

function sanitizeCustomPreset(
  value: unknown,
  knownVoicingIds: ReadonlySet<string>,
  seenIds: ReadonlySet<string>,
): Preset | null {
  const raw = asRecord(value)
  if (!raw) return null
  const id = asLibraryId(raw.id, BUILT_IN_PRESET_IDS)
  const name = asLibraryName(raw.name)
  const pool = sanitizePool(raw.pool)
  if (id === null || seenIds.has(id) || name === null || pool === null) {
    return null
  }
  if (!Array.isArray(raw.voicingIds)) return null
  // References to since-deleted rules are filtered, not fatal — the preset
  // keeps drilling its surviving rules (the editor warns about the rest).
  const voicingIds = [
    ...new Set(
      raw.voicingIds.filter(
        (v): v is string => typeof v === 'string' && knownVoicingIds.has(v),
      ),
    ),
  ]
  if (voicingIds.length === 0) return null
  return { id, name, pool, voicingIds }
}

export function sanitizeCustomPresets(
  value: unknown,
  customRules: readonly VoicingRule[],
): Preset[] {
  if (!Array.isArray(value)) return []
  const knownVoicingIds = new Set([
    ...BUILT_IN_RULE_IDS,
    ...customRules.map((r) => r.id),
  ])
  const presets: Preset[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const preset = sanitizeCustomPreset(entry, knownVoicingIds, seen)
    if (preset) {
      presets.push(preset)
      seen.add(preset.id)
    }
  }
  return presets
}

export function sanitizeStateV1(
  raw: Record<string, unknown>,
): PersistedStateV1 {
  const customVoicingRules = sanitizeCustomVoicingRules(raw.customVoicingRules)
  return {
    version: SCHEMA_VERSION,
    settings: sanitizeSettings(raw.settings),
    lastMidiDevice: sanitizeDevice(raw.lastMidiDevice),
    presetSelection: sanitizePresetSelection(raw.presetSelection),
    comboStats: sanitizeComboStats(raw.comboStats),
    dailyRecords: sanitizeDailyRecords(raw.dailyRecords),
    customVoicingRules,
    customPresets: sanitizeCustomPresets(raw.customPresets, customVoicingRules),
  }
}
