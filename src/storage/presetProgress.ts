// Persisted flashcard unlock progress (§5/§8): one record per preset id in
// the v2 schema. The pure progress logic (initial/reconcile/recording) lives
// in practice/progress.ts — this is only the storage backend, mirroring
// PersistedComboStats.

import type { PresetProgressRecord } from '../practice'
import type { AppStorage } from './appStorage'

export interface PresetProgressSource {
  get(presetId: string): PresetProgressRecord | null
  set(presetId: string, record: PresetProgressRecord): void
  // Deletes the record — the preset restarts at the initial unlock count on
  // its next load.
  reset(presetId: string): void
}

export class PersistedPresetProgress implements PresetProgressSource {
  private readonly storage: AppStorage

  constructor(storage: AppStorage) {
    this.storage = storage
  }

  get(presetId: string): PresetProgressRecord | null {
    return this.storage.state.presetProgress[presetId] ?? null
  }

  set(presetId: string, record: PresetProgressRecord): void {
    this.storage.update((state) => ({
      ...state,
      presetProgress: { ...state.presetProgress, [presetId]: record },
    }))
  }

  reset(presetId: string): void {
    this.storage.update((state) => {
      const { [presetId]: _removed, ...rest } = state.presetProgress
      return { ...state, presetProgress: rest }
    })
  }
}

// Test double for stores that shouldn't touch the appStorage singleton.
export class InMemoryPresetProgress implements PresetProgressSource {
  private readonly byPreset = new Map<string, PresetProgressRecord>()

  get(presetId: string): PresetProgressRecord | null {
    return this.byPreset.get(presetId) ?? null
  }

  set(presetId: string, record: PresetProgressRecord): void {
    this.byPreset.set(presetId, record)
  }

  reset(presetId: string): void {
    this.byPreset.delete(presetId)
  }
}
