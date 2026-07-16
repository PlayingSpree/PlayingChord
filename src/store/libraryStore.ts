import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { Preset } from '../practice'
import type { VoicingRule } from '../theory'
import {
  appStorage,
  exportLibraryJson,
  planImport,
  sanitizeCustomPresets,
  sanitizeCustomVoicingRules,
  type ImportResult,
} from '../storage'

// The custom library (DESIGN.md §4): user-built voicing rules and presets,
// persisted in the versioned schema. The practice store folds these into
// its preset list / rule lookup and re-resolves on every change here.

export interface LibraryMemory {
  load(): {
    rules: readonly VoicingRule[]
    presets: readonly Preset[]
  }
  save(rules: readonly VoicingRule[], presets: readonly Preset[]): void
}

export const persistedLibraryMemory: LibraryMemory = {
  load: () => ({
    rules: appStorage.state.customVoicingRules,
    presets: appStorage.state.customPresets,
  }),
  save: (rules, presets) =>
    appStorage.update((state) => ({
      ...state,
      customVoicingRules: [...rules],
      customPresets: [...presets],
    })),
}

export interface LibraryStoreState {
  customRules: readonly VoicingRule[]
  customPresets: readonly Preset[]
  // Add or replace (by id). False when the item didn't survive
  // sanitizing — the editors validate first, so that's a bug guard.
  saveRule(rule: VoicingRule): boolean
  savePreset(preset: Preset): boolean
  // False when the rule is still referenced by a custom preset: deletion is
  // blocked (§4 presets reference rules by id), edit the presets first.
  deleteRule(id: string): boolean
  deletePreset(id: string): void
  importJson(json: string): ImportResult
  exportJson(): string
}

export function createLibraryStore(
  memory: LibraryMemory = persistedLibraryMemory,
) {
  return createStore<LibraryStoreState>()((set, get) => {
    const commit = (
      rules: readonly VoicingRule[],
      presets: readonly Preset[],
    ) => {
      memory.save(rules, presets)
      set({ customRules: rules, customPresets: presets })
    }

    // Replace-or-append keyed by id, preserving list order for stable UI.
    const upsert = <T extends { id: string }>(
      list: readonly T[],
      item: T,
    ): T[] =>
      list.some((entry) => entry.id === item.id)
        ? list.map((entry) => (entry.id === item.id ? item : entry))
        : [...list, item]

    const initial = memory.load()
    return {
      customRules: initial.rules,
      customPresets: initial.presets,

      saveRule(rule: VoicingRule): boolean {
        // Sanitizing keeps persisted data canonical (trimmed names, valid
        // bounds) no matter what the caller built.
        const [clean] = sanitizeCustomVoicingRules([rule])
        if (!clean) return false
        commit(upsert(get().customRules, clean), get().customPresets)
        return true
      },

      savePreset(preset: Preset): boolean {
        const [clean] = sanitizeCustomPresets([preset], get().customRules)
        if (!clean) return false
        commit(get().customRules, upsert(get().customPresets, clean))
        return true
      },

      deleteRule(id: string): boolean {
        if (
          get().customPresets.some((preset) => preset.voicingIds.includes(id))
        ) {
          return false
        }
        commit(
          get().customRules.filter((rule) => rule.id !== id),
          get().customPresets,
        )
        return true
      },

      deletePreset(id: string) {
        commit(
          get().customRules,
          get().customPresets.filter((preset) => preset.id !== id),
        )
      },

      importJson(json: string): ImportResult {
        const result = planImport(json, get().customRules, get().customPresets)
        if (result.ok) {
          const { voicingRules, presets } = result.plan
          if (voicingRules.length > 0 || presets.length > 0) {
            commit(
              [...get().customRules, ...voicingRules],
              [...get().customPresets, ...presets],
            )
          }
        }
        return result
      },

      exportJson(): string {
        return exportLibraryJson(get().customRules, get().customPresets)
      },
    }
  })
}

export const libraryStore = createLibraryStore()

export function useLibrary<T>(selector: (state: LibraryStoreState) => T): T {
  return useStore(libraryStore, selector)
}
