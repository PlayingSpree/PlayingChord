// The ONLY place that touches window.localStorage (DESIGN.md §8) — the rest
// of storage/ is pure and takes a KeyValueStore. All failures (privacy mode,
// quota, no window at all) degrade to in-memory-only operation.

import { AppStorage, type KeyValueStore } from './appStorage'

export const localStorageKV: KeyValueStore = {
  get(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value)
      return true
    } catch {
      return false
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Nothing to do — the legacy key just lingers.
    }
  },
}

// App-wide singleton; the Zustand stores build their memory adapters on it.
export const appStorage = new AppStorage(localStorageKV)
