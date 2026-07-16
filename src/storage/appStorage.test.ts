import { describe, expect, it } from 'vitest'
import { DEFAULT_PRACTICE_SETTINGS } from '../practice'
import { AppStorage, type KeyValueStore } from './appStorage'
import { LEGACY_KEYS } from './migrate'
import { defaultState, STATE_STORAGE_KEY } from './schema'

function fakeKV(
  initial: Record<string, string> = {},
  { failWrites = false } = {},
): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial))
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set(key, value) {
      if (failWrites) return false
      data.set(key, value)
      return true
    },
    remove(key) {
      data.delete(key)
    },
  }
}

describe('AppStorage', () => {
  it('starts from defaults and persists the versioned state immediately', () => {
    const kv = fakeKV()
    const storage = new AppStorage(kv)
    expect(storage.state).toEqual(defaultState())
    expect(JSON.parse(kv.data.get(STATE_STORAGE_KEY)!)).toEqual(defaultState())
  })

  it('migrates the legacy plain keys and removes them after a good write', () => {
    const kv = fakeKV({
      [LEGACY_KEYS.settings]: JSON.stringify({
        ...DEFAULT_PRACTICE_SETTINGS,
        autoAdvanceMs: 1200,
      }),
      [LEGACY_KEYS.device]: JSON.stringify({ id: 'd', name: 'Piano' }),
      [LEGACY_KEYS.preset]: JSON.stringify({
        presetId: 'diatonic',
        diatonicKey: 7,
      }),
    })
    const storage = new AppStorage(kv)
    expect(storage.state.settings.autoAdvanceMs).toBe(1200)
    expect(storage.state.lastMidiDevice?.name).toBe('Piano')
    expect(storage.state.presetSelection?.presetId).toBe('diatonic')
    expect(kv.data.has(LEGACY_KEYS.settings)).toBe(false)
    expect(kv.data.has(LEGACY_KEYS.device)).toBe(false)
    expect(kv.data.has(LEGACY_KEYS.preset)).toBe(false)
  })

  it('keeps the legacy keys when the versioned write fails', () => {
    const kv = fakeKV(
      { [LEGACY_KEYS.device]: JSON.stringify({ id: 'd', name: 'Piano' }) },
      { failWrites: true },
    )
    const storage = new AppStorage(kv)
    expect(storage.state.lastMidiDevice?.name).toBe('Piano') // still usable
    expect(kv.data.has(LEGACY_KEYS.device)).toBe(true)
  })

  it('survives corrupted JSON at the state key', () => {
    const kv = fakeKV({ [STATE_STORAGE_KEY]: '{not json' })
    expect(new AppStorage(kv).state).toEqual(defaultState())
  })

  it('update() persists and a fresh instance reads it back', () => {
    const kv = fakeKV()
    const first = new AppStorage(kv)
    first.update((state) => ({
      ...state,
      settings: { ...state.settings, judgmentDelayMs: 900 },
    }))
    const second = new AppStorage(kv)
    expect(second.state.settings.judgmentDelayMs).toBe(900)
  })
})
