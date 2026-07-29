// Migration into the current schema version (DESIGN.md §8) — the hook
// exists from the first persisted byte so stats-format churn stays cheap.

import {
  defaultState,
  sanitizeDevice,
  sanitizePresetSelection,
  sanitizeStateV1,
  sanitizeStateV2,
  sanitizeStateV3,
  SCHEMA_VERSION,
  type PersistedState,
  type PersistedStateV1,
  type PersistedStateV2,
} from './schema'
import { sanitizeSettings } from '../practice'

// The pre-versioned plain keys from Phases 2–5, absorbed into v1 on first
// load and then removed (see AppStorage).
export const LEGACY_KEYS = {
  settings: 'playingchord:settings',
  device: 'playingchord:lastMidiDevice',
  preset: 'playingchord:preset',
} as const

// Parsed JSON of whatever the legacy keys held (undefined when absent).
export interface LegacySnapshot {
  settings?: unknown
  device?: unknown
  preset?: unknown
}

// v1 → v2: unlock progress (§5) starts empty — every preset opens at the
// initial unlock count on first use; the lifetime best combo streak (also
// new in v2) starts at 0, same as a fresh install.
export function migrateV1ToV2(state: PersistedStateV1): PersistedStateV2 {
  return {
    ...state,
    version: 2,
    presetProgress: {},
    bestComboStreak: 0,
  }
}

// v2 → v3: the guided path (§5.1). `calibrated: false` is the whole of the
// migration — the first load then fast-passes every chapter combo the player's
// existing comboStats already prove (§5.2), so an upgrader opens at their real
// frontier rather than at chapter 1. That is why nothing here reads the old
// per-preset records: the durable half of what they described is the stat
// history, which survives untouched and is what calibration reads.
export function migrateV2ToV3(state: PersistedStateV2): PersistedState {
  // The per-preset unlock records are dropped rather than carried along and
  // ignored: nothing reads them, their record type is gone, and the durable half
  // of what they described — the stat history — survives untouched and is what
  // calibration reads.
  const { presetProgress: _retired, ...rest } = state
  return {
    ...rest,
    version: SCHEMA_VERSION,
    pathProgress: { calibrated: false, chapters: {} },
  }
}

// `raw` is the parsed value at STATE_STORAGE_KEY. Version upgrades chain
// here (v1 → v2 → … before the final sanitize) as the schema evolves. An
// unrecognized version — i.e. a *newer* build's state read by an older one —
// resets to defaults: downgrades are rare for a static site and stats are
// re-earnable, so no forward-compatibility machinery is warranted.
export function migrateState(
  raw: unknown,
  legacy: LegacySnapshot = {},
): PersistedState {
  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const state = raw as Record<string, unknown>
    if (state.version === SCHEMA_VERSION) return sanitizeStateV3(state)
    if (state.version === 2) return migrateV2ToV3(sanitizeStateV2(state))
    if (state.version === 1) {
      return migrateV2ToV3(migrateV1ToV2(sanitizeStateV1(state)))
    }
  }
  // Nothing versioned yet: fold in the Phase 2–5 plain keys (each may be
  // absent or junk — sanitizers fall back per slice). defaultState() is
  // already current-version, so no upgrade chain is needed here.
  return {
    ...defaultState(),
    settings: sanitizeSettings(legacy.settings),
    lastMidiDevice: sanitizeDevice(legacy.device),
    presetSelection: sanitizePresetSelection(legacy.preset),
  }
}
