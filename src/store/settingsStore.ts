import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import {
  DEFAULT_PRACTICE_SETTINGS,
  sanitizeSettings,
  type PracticeSettings,
} from '../practice'

// Practice settings (DESIGN.md §6.2/§6.3): plain localStorage key for now,
// like the MIDI device memory; migrates into the Phase 6 versioned schema.
export interface SettingsMemory {
  load(): PracticeSettings
  save(settings: PracticeSettings): void
}

const STORAGE_KEY = 'playingchord:settings'

export const localStorageSettingsMemory: SettingsMemory = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return DEFAULT_PRACTICE_SETTINGS
      return sanitizeSettings(JSON.parse(raw))
    } catch {
      return DEFAULT_PRACTICE_SETTINGS
    }
  },
  save(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // Private-mode or quota failures just lose the persistence.
    }
  },
}

export interface SettingsStoreState {
  settings: PracticeSettings
  update(patch: Partial<PracticeSettings>): void
}

export function createSettingsStore(
  memory: SettingsMemory = localStorageSettingsMemory,
) {
  return createStore<SettingsStoreState>()((set, get) => ({
    settings: memory.load(),

    update(patch: Partial<PracticeSettings>) {
      const settings = sanitizeSettings({ ...get().settings, ...patch })
      set({ settings })
      memory.save(settings)
    },
  }))
}

export const settingsStore = createSettingsStore()

export function useSettings<T>(selector: (state: SettingsStoreState) => T): T {
  return useStore(settingsStore, selector)
}
