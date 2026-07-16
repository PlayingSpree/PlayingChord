import { describe, expect, it } from 'vitest'
import { DEFAULT_PRACTICE_SETTINGS } from '../practice'
import { migrateState } from './migrate'
import { defaultState } from './schema'

describe('migrateState', () => {
  it('returns defaults when nothing was ever persisted', () => {
    expect(migrateState(undefined)).toEqual(defaultState())
  })

  it('passes a valid v1 state through, sanitized', () => {
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
    }
    expect(migrateState(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })

  it('folds the Phase 2–5 plain keys into a fresh v1 state', () => {
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
    const newer = { version: 2, settings: { judgmentDelayMs: 750 } }
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
