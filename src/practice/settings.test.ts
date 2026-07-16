import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRACTICE_SETTINGS,
  MAX_DELAY_MS,
  sanitizeSettings,
} from './settings'

describe('sanitizeSettings', () => {
  it('returns defaults for non-object input', () => {
    for (const junk of [undefined, null, 42, 'settings', []]) {
      expect(sanitizeSettings(junk)).toEqual(DEFAULT_PRACTICE_SETTINGS)
    }
  })

  it('keeps valid fields and drops unknown ones', () => {
    const result = sanitizeSettings({
      strictExtraNotes: false,
      judgmentDelayMs: 250,
      legacyField: 'ignored',
    })
    expect(result).toEqual({
      ...DEFAULT_PRACTICE_SETTINGS,
      strictExtraNotes: false,
      judgmentDelayMs: 250,
    })
    expect('legacyField' in result).toBe(false)
  })

  it('falls back to defaults for wrong-typed fields', () => {
    expect(
      sanitizeSettings({
        allowOctaveDoubling: 'yes',
        strictExtraNotes: 0,
        judgmentDelayMs: '500',
        autoAdvanceMs: NaN,
      }),
    ).toEqual(DEFAULT_PRACTICE_SETTINGS)
  })

  it('clamps and rounds delays', () => {
    expect(sanitizeSettings({ judgmentDelayMs: -50 }).judgmentDelayMs).toBe(0)
    expect(sanitizeSettings({ autoAdvanceMs: 1e9 }).autoAdvanceMs).toBe(
      MAX_DELAY_MS,
    )
    expect(sanitizeSettings({ judgmentDelayMs: 333.4 }).judgmentDelayMs).toBe(
      333,
    )
  })

  it('round-trips already-valid settings unchanged', () => {
    const valid = {
      allowOctaveDoubling: false,
      strictExtraNotes: false,
      judgmentDelayMs: 750,
      autoAdvanceMs: 1200,
    }
    expect(sanitizeSettings(valid)).toEqual(valid)
  })
})
