import { describe, expect, it } from 'vitest'
import { exportBackupJson, parseBackup, restoredState } from './backup'
import { defaultState, SCHEMA_VERSION, type PersistedState } from './schema'

function sampleState(): PersistedState {
  return {
    ...defaultState(),
    lastMidiDevice: { id: 'there', name: 'Studio piano' },
    dailyRecords: {
      '2026-10-01': {
        date: '2026-10-01',
        activeMinutes: 12,
        prompts: 40,
        firstTrySuccesses: 31,
        timedPrompts: 40,
        timeToCorrectMs: 80_000,
      },
    },
    bestComboStreak: 17,
    side: 'scales',
  }
}

describe('exportBackupJson / parseBackup (§8)', () => {
  it('round-trips the whole state', () => {
    const state = sampleState()
    const json = exportBackupJson(state, new Date('2026-10-04T09:30:00Z'))
    const parsed = JSON.parse(json) as { kind: string }
    expect(parsed.kind).toBe('playingchord-backup')

    const result = parseBackup(json)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state).toEqual(state)
    expect(result.exportedAt).toBe('2026-10-04T09:30:00.000Z')
  })

  it('rejects junk, wrong kinds, a library file, and missing versions', () => {
    expect(parseBackup('not json').ok).toBe(false)
    expect(parseBackup('[1,2,3]').ok).toBe(false)
    expect(parseBackup('{"kind":"playingchord-library","version":2}').ok).toBe(
      false,
    )
    expect(parseBackup('{"kind":"playingchord-backup"}').ok).toBe(false)
    expect(
      parseBackup('{"kind":"playingchord-backup","state":{"version":0}}').ok,
    ).toBe(false)
  })

  it('refuses a newer schema instead of resetting to defaults', () => {
    const json = JSON.stringify({
      kind: 'playingchord-backup',
      state: { ...sampleState(), version: SCHEMA_VERSION + 1 },
    })
    const result = parseBackup(json)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('newer')
  })

  it('migrates an older schema and sanitizes junk slices', () => {
    const { presetProgress: _p, ...v2Only } = sampleState()
    const v1 = { ...v2Only, version: 1, comboStats: 'garbage' }
    const result = parseBackup(
      JSON.stringify({ kind: 'playingchord-backup', state: v1 }),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.state.version).toBe(SCHEMA_VERSION)
    expect(result.state.comboStats).toEqual({})
    expect(result.state.dailyRecords).toEqual(sampleState().dailyRecords)
    expect(result.exportedAt).toBeNull()
  })
})

describe('restoredState', () => {
  it('takes the backup wholesale but keeps this machine’s MIDI device', () => {
    const current = {
      ...defaultState(),
      lastMidiDevice: { id: 'here', name: 'Home keyboard' },
    }
    const next = restoredState(sampleState(), current)
    expect(next).toEqual({
      ...sampleState(),
      lastMidiDevice: { id: 'here', name: 'Home keyboard' },
    })
  })
})
