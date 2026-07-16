import { describe, expect, it } from 'vitest'
import { DEFAULT_PRACTICE_SETTINGS, type PracticeSettings } from '../practice'
import { createSettingsStore, type SettingsMemory } from './settingsStore'

function fakeMemory(initial?: PracticeSettings) {
  let stored = initial ?? null
  const memory: SettingsMemory = {
    load: () => stored ?? DEFAULT_PRACTICE_SETTINGS,
    save: (settings) => {
      stored = settings
    },
  }
  return {
    memory,
    get stored() {
      return stored
    },
  }
}

describe('settingsStore', () => {
  it('starts from the remembered settings', () => {
    const remembered = { ...DEFAULT_PRACTICE_SETTINGS, judgmentDelayMs: 900 }
    const store = createSettingsStore(fakeMemory(remembered).memory)
    expect(store.getState().settings).toEqual(remembered)
  })

  it('applies partial updates and persists the result', () => {
    const mem = fakeMemory()
    const store = createSettingsStore(mem.memory)

    store.getState().update({ strictExtraNotes: false, autoAdvanceMs: 1000 })

    const expected = {
      ...DEFAULT_PRACTICE_SETTINGS,
      strictExtraNotes: false,
      autoAdvanceMs: 1000,
    }
    expect(store.getState().settings).toEqual(expected)
    expect(mem.stored).toEqual(expected)
  })

  it('sanitizes wild updates instead of storing them', () => {
    const mem = fakeMemory()
    const store = createSettingsStore(mem.memory)

    store.getState().update({ judgmentDelayMs: -100 })
    expect(store.getState().settings.judgmentDelayMs).toBe(0)

    store.getState().update({ judgmentDelayMs: Number.NaN })
    expect(store.getState().settings.judgmentDelayMs).toBe(
      DEFAULT_PRACTICE_SETTINGS.judgmentDelayMs,
    )
  })
})
