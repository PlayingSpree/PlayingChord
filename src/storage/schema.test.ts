import { describe, expect, it } from 'vitest'
import {
  defaultState,
  localDateKey,
  sanitizeComboStats,
  sanitizeDailyRecords,
  sanitizeDevice,
  sanitizePresetSelection,
  sanitizeStateV1,
} from './schema'
import { RECENT_OUTCOME_WINDOW, TIME_TO_CORRECT_SAMPLE_CAP } from '../practice'

describe('localDateKey', () => {
  it('formats the local date with zero padding', () => {
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
    expect(localDateKey(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('sanitizeDevice', () => {
  it('accepts a valid device and rejects junk', () => {
    expect(sanitizeDevice({ id: 'a', name: 'Piano' })).toEqual({
      id: 'a',
      name: 'Piano',
    })
    expect(sanitizeDevice({ id: 1, name: 'Piano' })).toBeNull()
    expect(sanitizeDevice('piano')).toBeNull()
    expect(sanitizeDevice(null)).toBeNull()
  })
})

describe('sanitizePresetSelection', () => {
  it('accepts a valid selection', () => {
    expect(
      sanitizePresetSelection({ presetId: 'diatonic', diatonicKey: 11 }),
    ).toEqual({ presetId: 'diatonic', diatonicKey: 11 })
  })

  it('rejects out-of-range keys and missing ids', () => {
    expect(
      sanitizePresetSelection({ presetId: 'x', diatonicKey: 12 }),
    ).toBeNull()
    expect(
      sanitizePresetSelection({ presetId: 'x', diatonicKey: 1.5 }),
    ).toBeNull()
    expect(sanitizePresetSelection({ diatonicKey: 0 })).toBeNull()
  })
})

describe('sanitizeComboStats', () => {
  const valid = {
    attempts: 4,
    firstTrySuccesses: 2,
    recentOutcomes: ['missed', 'first-try'],
    timeToCorrectMs: [1200, 3400],
  }

  it('keeps valid records and drops garbled ones whole', () => {
    const stats = sanitizeComboStats({
      good: valid,
      negative: { ...valid, attempts: -1 },
      impossible: { ...valid, firstTrySuccesses: 9 },
      notARecord: 'hi',
    })
    expect(Object.keys(stats)).toEqual(['good'])
    expect(stats.good).toEqual(valid)
  })

  it('filters junk outcomes/samples and caps both windows', () => {
    const stats = sanitizeComboStats({
      key: {
        attempts: 100,
        firstTrySuccesses: 0,
        recentOutcomes: Array(20).fill('missed').concat(['nonsense']),
        timeToCorrectMs: Array(50).fill(1000).concat(['NaN', -5.7]),
      },
    })
    expect(stats.key?.recentOutcomes).toHaveLength(RECENT_OUTCOME_WINDOW)
    expect(stats.key?.timeToCorrectMs).toHaveLength(TIME_TO_CORRECT_SAMPLE_CAP)
    expect(stats.key?.timeToCorrectMs?.at(-1)).toBe(0) // -5.7 clamped
  })

  it('returns empty for non-objects', () => {
    expect(sanitizeComboStats(undefined)).toEqual({})
    expect(sanitizeComboStats([1, 2])).toEqual({})
  })
})

describe('sanitizeDailyRecords', () => {
  const valid = {
    date: '2026-07-16',
    activeMinutes: 12.5,
    prompts: 30,
    firstTrySuccesses: 24,
  }

  it('keeps valid records keyed by their own date', () => {
    const records = sanitizeDailyRecords({ 'wrong-key': valid })
    expect(records).toEqual({ '2026-07-16': valid })
  })

  it('drops malformed dates and impossible counts', () => {
    expect(
      sanitizeDailyRecords({
        a: { ...valid, date: '16/07/2026' },
        b: { ...valid, prompts: 3, firstTrySuccesses: 5 },
        c: { ...valid, activeMinutes: -1 },
      }),
    ).toEqual({})
  })
})

describe('sanitizeStateV1', () => {
  it('coerces a fully junk payload to defaults', () => {
    expect(
      sanitizeStateV1({
        version: 1,
        settings: 'junk',
        lastMidiDevice: 42,
        presetSelection: [],
        comboStats: null,
        dailyRecords: 7,
      }),
    ).toEqual(defaultState())
  })
})
