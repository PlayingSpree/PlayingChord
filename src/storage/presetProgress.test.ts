import { describe, expect, it } from 'vitest'
import { AppStorage, type KeyValueStore } from './appStorage'
import { STATE_STORAGE_KEY } from './schema'
import { PersistedPresetProgress } from './presetProgress'

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

describe('PersistedPresetProgress (§5/§8)', () => {
  it('returns null for a preset with no stored progress', () => {
    const progress = new PersistedPresetProgress(new AppStorage(fakeKV()))
    expect(progress.get('major-triads')).toBeNull()
  })

  it('set persists a record readable through a fresh AppStorage', () => {
    const kv = fakeKV()
    const progress = new PersistedPresetProgress(new AppStorage(kv))
    progress.set('major-triads', { unlockedCount: 5, masteredIndices: [0, 1] })
    const reloaded = new PersistedPresetProgress(new AppStorage(kv))
    expect(reloaded.get('major-triads')).toEqual({
      unlockedCount: 5,
      masteredIndices: [0, 1],
    })
  })

  it('records are independent per preset id', () => {
    const progress = new PersistedPresetProgress(new AppStorage(fakeKV()))
    progress.set('a', { unlockedCount: 3, masteredIndices: [] })
    progress.set('b', { unlockedCount: 7, masteredIndices: [2] })
    expect(progress.get('a')).toEqual({ unlockedCount: 3, masteredIndices: [] })
    expect(progress.get('b')).toEqual({
      unlockedCount: 7,
      masteredIndices: [2],
    })
  })

  it('reset deletes only the given preset and persists the removal', () => {
    const kv = fakeKV()
    const progress = new PersistedPresetProgress(new AppStorage(kv))
    progress.set('a', { unlockedCount: 5, masteredIndices: [0] })
    progress.set('b', { unlockedCount: 3, masteredIndices: [] })
    progress.reset('a')
    expect(progress.get('a')).toBeNull()
    expect(progress.get('b')).not.toBeNull()
    const raw = JSON.parse(kv.get(STATE_STORAGE_KEY) ?? '{}') as {
      presetProgress: Record<string, unknown>
    }
    expect(Object.keys(raw.presetProgress)).toEqual(['b'])
  })
})
