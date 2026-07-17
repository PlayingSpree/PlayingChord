import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRACTICE_SETTINGS,
  MAX_DAILY_GOAL_MINUTES,
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

  it('clamps the daily goal to at least a minute and rounds it', () => {
    expect(sanitizeSettings({ dailyGoalMinutes: 0 }).dailyGoalMinutes).toBe(1)
    expect(sanitizeSettings({ dailyGoalMinutes: -3 }).dailyGoalMinutes).toBe(1)
    expect(sanitizeSettings({ dailyGoalMinutes: 12.6 }).dailyGoalMinutes).toBe(
      13,
    )
    expect(sanitizeSettings({ dailyGoalMinutes: 1e6 }).dailyGoalMinutes).toBe(
      MAX_DAILY_GOAL_MINUTES,
    )
    expect(sanitizeSettings({ dailyGoalMinutes: '10' }).dailyGoalMinutes).toBe(
      DEFAULT_PRACTICE_SETTINGS.dailyGoalMinutes,
    )
  })

  it('round-trips already-valid settings unchanged', () => {
    const valid = {
      allowOctaveDoubling: false,
      strictExtraNotes: false,
      judgmentDelayMs: 750,
      autoAdvanceMs: 1200,
      dailyGoalMinutes: 20,
      staffEnabled: false,
      staffKeyEnabled: true,
      chimeEnabled: false,
      chordNameSize: 'sm',
    }
    expect(sanitizeSettings(valid)).toEqual(valid)
  })

  it('defaults the staff and chime toggles on and coerces junk', () => {
    // Added within schema v1 (Phase 8) — pre-existing persisted states have
    // neither field, so the sanitizer must fill both.
    expect(sanitizeSettings({})).toMatchObject({
      staffEnabled: true,
      staffKeyEnabled: false,
      chimeEnabled: true,
    })
    const result = sanitizeSettings({ staffEnabled: 0, chimeEnabled: 'off' })
    expect(result.staffEnabled).toBe(true)
    expect(result.chimeEnabled).toBe(true)
    expect(sanitizeSettings({ chimeEnabled: false }).chimeEnabled).toBe(false)
  })

  it('defaults the chord name size and rejects unknown values', () => {
    expect(sanitizeSettings({}).chordNameSize).toBe('lg')
    for (const size of ['sm', 'md', 'lg', 'xl']) {
      expect(sanitizeSettings({ chordNameSize: size }).chordNameSize).toBe(size)
    }
    expect(sanitizeSettings({ chordNameSize: 'huge' }).chordNameSize).toBe('lg')
    expect(sanitizeSettings({ chordNameSize: 3 }).chordNameSize).toBe('lg')
  })
})
