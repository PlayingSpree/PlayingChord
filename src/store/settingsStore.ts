import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { sanitizeSettings, type PracticeSettings } from '../practice'
import { appStorage } from '../storage'

// Practice settings (DESIGN.md §6.2/§6.3), persisted in the versioned
// schema (§8) — the Phase 4 plain key migrates on first load.
export interface SettingsMemory {
  load(): PracticeSettings
  save(settings: PracticeSettings): void
}

export const persistedSettingsMemory: SettingsMemory = {
  load: () => appStorage.state.settings, // sanitized during load/migration
  save: (settings) => appStorage.update((state) => ({ ...state, settings })),
}

export interface SettingsStoreState {
  settings: PracticeSettings
  update(patch: Partial<PracticeSettings>): void
}

export function createSettingsStore(
  memory: SettingsMemory = persistedSettingsMemory,
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
