// The app's persisted-state holder: loads + migrates once at construction,
// then serves reads from memory and writes through on every update. Pure TS
// — the key-value backend is injected (localStorage in the app, a Map in
// tests).

import { LEGACY_KEYS, migrateState } from './migrate'
import { STATE_STORAGE_KEY, type PersistedState } from './schema'

export interface KeyValueStore {
  get(key: string): string | null
  // false when the write failed (quota, privacy mode) — persistence is then
  // best-effort for the session, but the app keeps working from memory.
  set(key: string, value: string): boolean
  remove(key: string): void
}

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

export class AppStorage {
  private readonly kv: KeyValueStore
  private current: PersistedState

  constructor(kv: KeyValueStore) {
    this.kv = kv
    this.current = migrateState(parseJson(kv.get(STATE_STORAGE_KEY)), {
      settings: parseJson(kv.get(LEGACY_KEYS.settings)),
      device: parseJson(kv.get(LEGACY_KEYS.device)),
      preset: parseJson(kv.get(LEGACY_KEYS.preset)),
    })
    // Persist the migrated shape immediately; the legacy plain keys are only
    // dropped once the versioned write is known to have landed.
    if (this.persist()) {
      for (const key of Object.values(LEGACY_KEYS)) kv.remove(key)
    }
  }

  get state(): PersistedState {
    return this.current
  }

  update(mutate: (state: PersistedState) => PersistedState): void {
    this.current = mutate(this.current)
    this.persist()
  }

  private persist(): boolean {
    return this.kv.set(STATE_STORAGE_KEY, JSON.stringify(this.current))
  }
}
