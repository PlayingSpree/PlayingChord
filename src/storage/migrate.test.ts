import { describe, expect, it } from 'vitest'
import { DEFAULT_PRACTICE_SETTINGS } from '../practice'
import { migrateState } from './migrate'
import { defaultState, SCHEMA_VERSION } from './schema'

describe('migrateState', () => {
  it('returns defaults when nothing was ever persisted', () => {
    expect(migrateState(undefined)).toEqual(defaultState())
  })

  it('passes a valid current-version state through, sanitized', () => {
    const state = {
      ...defaultState(),
      comboStats: {
        '0:maj:any': {
          attempts: 2,
          firstTrySuccesses: 1,
          recentOutcomes: ['missed', 'first-try'],
          timeToCorrectMs: [4000, 1500],
        },
      },
      bestComboStreak: 7,
    }
    expect(migrateState(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })

  it('upgrades a v1 state through the whole chain, keeping its data', () => {
    const v1 = {
      ...defaultState(),
      version: 1,
      comboStats: {
        '0:maj:any': {
          attempts: 2,
          firstTrySuccesses: 1,
          recentOutcomes: ['missed', 'first-try'],
          timeToCorrectMs: [4000, 1500],
        },
      },
    } as Record<string, unknown>
    delete v1.presetProgress
    delete v1.bestComboStreak
    delete v1.pathProgress
    const state = migrateState(v1)
    expect(state.version).toBe(SCHEMA_VERSION)
    expect(state.comboStats).toEqual(v1.comboStats)
    expect(state.bestComboStreak).toBe(0)
    expect(state.pathProgress).toEqual({ calibrated: false, chapters: {} })
  })

  it('upgrades a v2 state to v3, leaving the path uncalibrated', () => {
    // The whole of §5.2's migration: `calibrated: false` means the first load
    // fast-passes whatever this player's comboStats already prove, so they open
    // at their real frontier rather than back at chapter 1.
    const v2 = {
      ...defaultState(),
      version: 2,
      comboStats: {
        '0:maj:any': {
          attempts: 6,
          firstTrySuccesses: 6,
          recentOutcomes: Array(6).fill('first-try'),
          timeToCorrectMs: Array(6).fill(600),
        },
      },
      presetProgress: {
        'major-triads': {
          unlockedCount: 9,
          masteredIndices: [0, 1, 2],
          setAsideIndices: [],
        },
      },
      // Dropped by the migration, not carried along ignored.
      bestComboStreak: 11,
    } as Record<string, unknown>
    delete v2.pathProgress
    const state = migrateState(v2)
    expect(state.version).toBe(SCHEMA_VERSION)
    expect(state.pathProgress).toEqual({ calibrated: false, chapters: {} })
    expect('presetProgress' in state).toBe(false)
    // The durable half of the retired per-preset records is the stat history,
    // which survives untouched — it is what calibration reads.
    expect(state.comboStats).toEqual(v2.comboStats)
    expect(state.bestComboStreak).toBe(11)
  })

  it('keeps a v3 state’s path progress through the passthrough', () => {
    const state = migrateState({
      ...defaultState(),
      pathProgress: {
        calibrated: true,
        chapters: {
          'key-c': { passed: [0, 1], setAside: [0], songStamped: true },
        },
      },
    })
    expect(state.pathProgress).toEqual({
      calibrated: true,
      chapters: {
        'key-c': { passed: [0, 1], setAside: [0], songStamped: true },
      },
    })
  })

  it('folds the Phase 2–5 plain keys into a fresh state', () => {
    const state = migrateState(undefined, {
      settings: { ...DEFAULT_PRACTICE_SETTINGS, judgmentDelayMs: 750 },
      device: { id: 'dev-1', name: 'Stage Piano' },
      preset: { presetId: 'seventh-chords', diatonicKey: 4 },
    })
    expect(state.settings.judgmentDelayMs).toBe(750)
    expect(state.lastMidiDevice).toEqual({ id: 'dev-1', name: 'Stage Piano' })
    expect(state.presetSelection).toEqual({
      presetId: 'seventh-chords',
      diatonicKey: 4,
    })
    expect(state.comboStats).toEqual({})
  })

  it('tolerates junk in individual legacy keys', () => {
    const state = migrateState(undefined, {
      settings: 'garbage',
      device: { id: 'dev-1', name: 'Stage Piano' },
      preset: 42,
    })
    expect(state.settings).toEqual(DEFAULT_PRACTICE_SETTINGS)
    expect(state.lastMidiDevice).toEqual({ id: 'dev-1', name: 'Stage Piano' })
    expect(state.presetSelection).toBeNull()
  })

  it('resets on an unrecognized (newer) version instead of guessing', () => {
    const newer = {
      version: SCHEMA_VERSION + 1,
      settings: { judgmentDelayMs: 750 },
    }
    expect(migrateState(newer)).toEqual(defaultState())
  })

  it('ignores legacy keys when a versioned state exists', () => {
    const state = migrateState(defaultState(), {
      settings: { ...DEFAULT_PRACTICE_SETTINGS, judgmentDelayMs: 9999 },
    })
    expect(state.settings.judgmentDelayMs).toBe(
      DEFAULT_PRACTICE_SETTINGS.judgmentDelayMs,
    )
  })
})
