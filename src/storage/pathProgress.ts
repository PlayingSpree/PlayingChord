// Persisted guided-path progress (§5.1/§8): one record for the whole path in
// the v3 schema, not a map like the per-preset records it replaces. The pure
// logic — position, passing, calibration — lives in practice/path.ts; this is
// only the storage backend.

import { emptyPathProgress, type PathProgressRecord } from '../practice'
import type { AppStorage } from './appStorage'

export interface PathProgressSource {
  get(): PathProgressRecord
  set(record: PathProgressRecord): void
  // "Reset path" (§6/§7.6). Deliberately restores `calibrated: false` rather
  // than just clearing the passes: the next load then re-derives the frontier
  // from the surviving stat history (§5.2), so resetting the path returns a
  // veteran to where their playing actually puts them instead of dumping them
  // at chapter 1 batch 1 — which would make the control a trap.
  reset(): void
}

export class PersistedPathProgress implements PathProgressSource {
  private readonly storage: AppStorage

  constructor(storage: AppStorage) {
    this.storage = storage
  }

  get(): PathProgressRecord {
    return this.storage.state.pathProgress
  }

  set(record: PathProgressRecord): void {
    this.storage.update((state) => ({ ...state, pathProgress: record }))
  }

  reset(): void {
    this.set(emptyPathProgress())
  }
}

// Test double for stores that shouldn't touch the appStorage singleton.
export class InMemoryPathProgress implements PathProgressSource {
  private record: PathProgressRecord = emptyPathProgress()

  get(): PathProgressRecord {
    return this.record
  }

  set(record: PathProgressRecord): void {
    this.record = record
  }

  reset(): void {
    this.record = emptyPathProgress()
  }
}
