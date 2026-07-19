// Migration into the current schema version (DESIGN.md §8) — the hook
// exists from the first persisted byte so stats-format churn stays cheap.

import {
  defaultState,
  sanitizeDevice,
  sanitizePresetSelection,
  sanitizeStateV1,
  sanitizeStateV2,
  SCHEMA_VERSION,
  type PersistedState,
  type PersistedStateV1,
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
// initial unlock count on first use.
export function migrateV1ToV2(state: PersistedStateV1): PersistedState {
  return { ...state, version: SCHEMA_VERSION, presetProgress: {} }
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
    if (state.version === SCHEMA_VERSION) return sanitizeStateV2(state)
    if (state.version === 1) return migrateV1ToV2(sanitizeStateV1(state))
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
