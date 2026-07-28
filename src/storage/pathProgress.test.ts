import { describe, expect, it } from 'vitest'
import { emptyPathProgress, type PathProgressRecord } from '../practice'
import { AppStorage, type KeyValueStore } from './appStorage'
import { PersistedPathProgress, InMemoryPathProgress } from './pathProgress'

function fakeKV(): KeyValueStore {
  const data = new Map<string, string>()
  return {
    get: (key) => data.get(key) ?? null,
    set(key, value) {
      data.set(key, value)
      return true
    },
    remove(key) {
      data.delete(key)
    },
  }
}

const RECORD: PathProgressRecord = {
  calibrated: true,
  chapters: {
    'key-c': { passed: [0, 1, 2], setAside: [1], songStamped: true },
    'key-g': { passed: [0], setAside: [], songStamped: false },
  },
}

describe('PersistedPathProgress (§5.1/§8)', () => {
  it('starts uncalibrated and empty', () => {
    const progress = new PersistedPathProgress(new AppStorage(fakeKV()))
    expect(progress.get()).toEqual(emptyPathProgress())
  })

  it('persists a record readable through a fresh AppStorage', () => {
    const kv = fakeKV()
    new PersistedPathProgress(new AppStorage(kv)).set(RECORD)
    expect(new PersistedPathProgress(new AppStorage(kv)).get()).toEqual(RECORD)
  })

  it('replaces the whole record — there is only one', () => {
    const progress = new PersistedPathProgress(new AppStorage(fakeKV()))
    progress.set(RECORD)
    progress.set({
      calibrated: true,
      chapters: { 'key-f': { passed: [0], setAside: [], songStamped: false } },
    })
    expect(Object.keys(progress.get().chapters)).toEqual(['key-f'])
  })

  it('reset clears progress *and* the calibration latch', () => {
    // Otherwise "reset path" would strand a veteran at chapter 1 instead of
    // letting the next load re-derive their frontier from their stats (§5.2).
    const kv = fakeKV()
    const progress = new PersistedPathProgress(new AppStorage(kv))
    progress.set(RECORD)
    progress.reset()
    expect(progress.get()).toEqual(emptyPathProgress())
    expect(progress.get().calibrated).toBe(false)
    expect(new PersistedPathProgress(new AppStorage(kv)).get().calibrated).toBe(
      false,
    )
  })

  it('leaves the rest of the state alone', () => {
    const kv = fakeKV()
    const storage = new AppStorage(kv)
    storage.update((state) => ({ ...state, bestComboStreak: 12 }))
    new PersistedPathProgress(storage).set(RECORD)
    expect(storage.state.bestComboStreak).toBe(12)
  })
})

describe('InMemoryPathProgress', () => {
  it('behaves like the persisted one without touching storage', () => {
    const progress = new InMemoryPathProgress()
    expect(progress.get()).toEqual(emptyPathProgress())
    progress.set(RECORD)
    expect(progress.get()).toEqual(RECORD)
    progress.reset()
    expect(progress.get()).toEqual(emptyPathProgress())
  })
})
