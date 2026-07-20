import { describe, expect, it } from 'vitest'
import {
  defaultState,
  localDateKey,
  MAX_BASS_DEGREE,
  MAX_LIBRARY_NAME_LENGTH,
  sanitizeBestComboStreak,
  sanitizeComboStats,
  sanitizeCustomPresets,
  sanitizeCustomVoicingRules,
  sanitizeDailyRecords,
  sanitizeDevice,
  sanitizePresetProgress,
  sanitizePresetSelection,
  sanitizeStateV1,
  sanitizeStateV2,
} from './schema'
import {
  EDITOR_MAX_HAND_NOTES,
  EDITOR_MAX_PATTERN_DEGREE,
  RECENT_OUTCOME_WINDOW,
  TIME_TO_CORRECT_SAMPLE_CAP,
} from '../practice'
import type { ConstraintVoicingRule } from '../theory'

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
    timeToCorrectMs: 45_000,
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

  it('defaults a missing or junk time-to-correct sum to 0 (early-v1 states)', () => {
    const { timeToCorrectMs: _dropped, ...earlyV1 } = valid
    expect(sanitizeDailyRecords({ a: earlyV1 })).toEqual({
      '2026-07-16': { ...valid, timeToCorrectMs: 0 },
    })
    expect(
      sanitizeDailyRecords({ a: { ...valid, timeToCorrectMs: -3 } }),
    ).toEqual({ '2026-07-16': { ...valid, timeToCorrectMs: 0 } })
  })
})

describe('sanitizeCustomVoicingRules (Phase 9, §4)', () => {
  const valid = {
    id: 'rule-abc123',
    name: 'Wide root',
    bass: { kind: 'chordTone', degree: 0 },
    span: { min: 12 },
    doubling: 'exact',
  }

  it('keeps valid rules and trims/caps names', () => {
    expect(sanitizeCustomVoicingRules([valid])).toEqual([valid])
    const [rule] = sanitizeCustomVoicingRules([
      { ...valid, name: `  padded ${'x'.repeat(100)}` },
    ])
    expect(rule?.name.startsWith('padded')).toBe(true)
    expect(rule?.name.length).toBe(MAX_LIBRARY_NAME_LENGTH)
  })

  it('drops garbled rules whole', () => {
    expect(
      sanitizeCustomVoicingRules([
        { ...valid, id: '' },
        { ...valid, name: '   ' },
        { ...valid, bass: { kind: 'chordTone', degree: MAX_BASS_DEGREE + 1 } },
        { ...valid, bass: { kind: 'lowest' } },
        { ...valid, doubling: 'sometimes' },
        { ...valid, span: { min: 20, max: 4 } }, // contradictory
        'junk',
      ]),
    ).toEqual([])
    expect(sanitizeCustomVoicingRules('junk')).toEqual([])
  })

  it('rejects built-in id shadowing and duplicate ids (first wins)', () => {
    const rules = sanitizeCustomVoicingRules([
      { ...valid, id: 'closed' },
      valid,
      { ...valid, name: 'Impostor' },
    ])
    expect(rules).toEqual([valid])
  })

  it('drops junk span fields without dropping the rule', () => {
    const [rule] = sanitizeCustomVoicingRules([
      { ...valid, span: { min: 'wide', max: 24 } },
    ])
    expect((rule as ConstraintVoicingRule | undefined)?.span).toEqual({
      max: 24,
    })
    const [noSpan] = sanitizeCustomVoicingRules([
      { ...valid, span: { min: null } },
    ])
    expect((noSpan as ConstraintVoicingRule | undefined)?.span).toBeUndefined()
  })
})

describe('sanitizeCustomVoicingRules — pattern rules (§3.3)', () => {
  const validPattern = {
    kind: 'pattern',
    id: 'rule-pat1',
    name: '1-5 + 1-2-5',
    leftHand: [1, 5],
    rightHand: [1, 2, 5],
  }

  it('keeps a valid pattern rule', () => {
    expect(sanitizeCustomVoicingRules([validPattern])).toEqual([validPattern])
  })

  it('accepts a one-hand pattern (the other hand empty)', () => {
    const oneHand = { ...validPattern, leftHand: [] }
    expect(sanitizeCustomVoicingRules([oneHand])).toEqual([oneHand])
  })

  it('drops a pattern with both hands empty (no notes at all)', () => {
    expect(
      sanitizeCustomVoicingRules([
        { ...validPattern, leftHand: [], rightHand: [] },
      ]),
    ).toEqual([])
  })

  it('drops a pattern with an out-of-range or non-integer degree', () => {
    expect(
      sanitizeCustomVoicingRules([
        { ...validPattern, rightHand: [1, EDITOR_MAX_PATTERN_DEGREE + 1] },
      ]),
    ).toEqual([])
    expect(
      sanitizeCustomVoicingRules([{ ...validPattern, leftHand: [0] }]),
    ).toEqual([])
    expect(
      sanitizeCustomVoicingRules([{ ...validPattern, leftHand: [1.5] }]),
    ).toEqual([])
  })

  it('accepts the max degree and the max hand size', () => {
    const maxed = {
      ...validPattern,
      leftHand: Array(EDITOR_MAX_HAND_NOTES).fill(EDITOR_MAX_PATTERN_DEGREE),
    }
    expect(sanitizeCustomVoicingRules([maxed])).toEqual([maxed])
  })

  it('drops a hand exceeding the max note count', () => {
    expect(
      sanitizeCustomVoicingRules([
        {
          ...validPattern,
          leftHand: Array(EDITOR_MAX_HAND_NOTES + 1).fill(1),
        },
      ]),
    ).toEqual([])
  })

  it('drops a pattern whose hand is not an array', () => {
    expect(
      sanitizeCustomVoicingRules([{ ...validPattern, rightHand: 'nope' }]),
    ).toEqual([])
  })

  it('still enforces id/name rules shared with constraint rules', () => {
    expect(
      sanitizeCustomVoicingRules([{ ...validPattern, id: 'closed' }]),
    ).toEqual([]) // built-in id shadow
    expect(
      sanitizeCustomVoicingRules([{ ...validPattern, name: '   ' }]),
    ).toEqual([])
  })
})

describe('sanitizeCustomPresets (Phase 9, §4)', () => {
  const customRule = {
    id: 'rule-abc123',
    name: 'Wide root',
    bass: { kind: 'any' as const },
    doubling: 'exact' as const,
  }
  const valid = {
    id: 'preset-abc123',
    name: 'My drill',
    pool: { kind: 'product', roots: [0, 5], chordTypes: ['maj', 'min7'] },
    voicingIds: ['any', 'rule-abc123'],
  }

  it('keeps valid presets referencing built-in and custom rules', () => {
    expect(sanitizeCustomPresets([valid], [customRule])).toEqual([valid])
  })

  it('filters unknown roots/types/voicing refs and drops empty results', () => {
    const [preset] = sanitizeCustomPresets(
      [
        {
          ...valid,
          pool: {
            kind: 'product',
            roots: [0, 12, 'x'],
            chordTypes: ['maj', 'nope'],
          },
          voicingIds: ['any', 'rule-gone'],
        },
      ],
      [],
    )
    expect(preset?.pool).toEqual({
      kind: 'product',
      roots: [0],
      chordTypes: ['maj'],
    })
    expect(preset?.voicingIds).toEqual(['any'])
    // Nothing valid left in a slot → the preset is dropped whole.
    expect(
      sanitizeCustomPresets(
        [
          { ...valid, voicingIds: ['rule-gone'] },
          {
            ...valid,
            pool: { kind: 'product', roots: [], chordTypes: ['maj'] },
          },
          { ...valid, pool: { kind: 'explicit', chords: [] } },
        ],
        [],
      ),
    ).toEqual([])
  })

  it('sanitizes explicit and diatonic pools', () => {
    const [explicit] = sanitizeCustomPresets(
      [
        {
          ...valid,
          pool: {
            kind: 'explicit',
            chords: [
              { root: 9, typeId: 'min' },
              { root: 9, typeId: 'min' }, // dupe collapses
              { root: 13, typeId: 'maj' }, // bad root dropped
            ],
          },
          voicingIds: ['any'],
        },
      ],
      [],
    )
    expect(explicit?.pool).toEqual({
      kind: 'explicit',
      chords: [{ root: 9, typeId: 'min' }],
    })
    expect(
      sanitizeCustomPresets(
        [{ ...valid, pool: { kind: 'diatonic', key: 12 } }],
        [],
      ),
    ).toEqual([])
  })

  it('rejects built-in preset id shadowing', () => {
    expect(
      sanitizeCustomPresets([{ ...valid, id: 'major-triads' }], []),
    ).toEqual([])
  })
})

describe('sanitizeStateV2', () => {
  it('coerces a fully junk payload to defaults', () => {
    expect(
      sanitizeStateV2({
        version: 2,
        settings: 'junk',
        lastMidiDevice: 42,
        presetSelection: [],
        comboStats: null,
        dailyRecords: 7,
        presetProgress: 'junk',
        bestComboStreak: 'not a number',
      }),
    ).toEqual(defaultState())
  })

  it('defaults the Phase 9 library slices in early-v1 states', () => {
    const state = sanitizeStateV1({ version: 1 })
    expect(state.customVoicingRules).toEqual([])
    expect(state.customPresets).toEqual([])
  })

  it('validates preset voicing refs against the sanitized custom rules', () => {
    const state = sanitizeStateV1({
      version: 1,
      customVoicingRules: [
        {
          id: 'rule-ok',
          name: 'OK',
          bass: { kind: 'any' },
          doubling: 'allowed',
        },
        { id: 'rule-bad', name: '', bass: { kind: 'any' }, doubling: 'exact' },
      ],
      customPresets: [
        {
          id: 'preset-a',
          name: 'A',
          pool: { kind: 'diatonic', key: 4 },
          voicingIds: ['rule-ok', 'rule-bad'],
        },
      ],
    })
    expect(state.customVoicingRules.map((r) => r.id)).toEqual(['rule-ok'])
    // The garbled rule was dropped, so the reference to it goes too.
    expect(state.customPresets[0]?.voicingIds).toEqual(['rule-ok'])
  })
})

describe('sanitizeBestComboStreak (v2, §7)', () => {
  it('keeps a valid non-negative integer', () => {
    expect(sanitizeBestComboStreak(12)).toBe(12)
    expect(sanitizeBestComboStreak(0)).toBe(0)
  })

  it('defaults garbled or absent values to 0', () => {
    expect(sanitizeBestComboStreak(undefined)).toBe(0)
    expect(sanitizeBestComboStreak(-3)).toBe(0)
    expect(sanitizeBestComboStreak('12')).toBe(0)
    expect(sanitizeBestComboStreak(1.5)).toBe(0)
  })
})

describe('sanitizePresetProgress (v2, §5)', () => {
  it('keeps valid records and drops garbled ones whole', () => {
    expect(
      sanitizePresetProgress({
        'major-triads': { unlockedCount: 5, masteredIndices: [0, 2] },
        'no-indices': { unlockedCount: 3 },
        'zero-unlocked': { unlockedCount: 0, masteredIndices: [] },
        'negative-unlocked': { unlockedCount: -2, masteredIndices: [] },
        'not-a-record': 42,
      }),
    ).toEqual({
      'major-triads': { unlockedCount: 5, masteredIndices: [0, 2] },
    })
  })

  it('filters out-of-range indices, dedupes, and sorts', () => {
    expect(
      sanitizePresetProgress({
        p: { unlockedCount: 4, masteredIndices: [3, 1, 3, -1, 4, 2.5, 'x'] },
      }),
    ).toEqual({ p: { unlockedCount: 4, masteredIndices: [1, 3] } })
  })

  it('returns empty for non-objects', () => {
    expect(sanitizePresetProgress(null)).toEqual({})
    expect(sanitizePresetProgress([])).toEqual({})
    expect(sanitizePresetProgress('junk')).toEqual({})
  })
})
