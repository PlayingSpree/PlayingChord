import { describe, expect, it } from 'vitest'
import { comboWeight, rankWorstCombos, type Combo } from '../practice'
import { AppStorage, type KeyValueStore } from './appStorage'
import { applyDailyPrompt, PersistedComboStats } from './persistedStats'

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

const KEY = '0:maj:any'
const COMBO: Combo = { root: 0, typeId: 'maj', voicingId: 'any' }

describe('applyDailyPrompt (§8 daily record)', () => {
  it('opens a fresh day at zero active minutes', () => {
    expect(applyDailyPrompt(undefined, '2026-07-16', 'first-try')).toEqual({
      date: '2026-07-16',
      activeMinutes: 0,
      prompts: 1,
      firstTrySuccesses: 1,
    })
  })

  it('accumulates prompts and first-try successes', () => {
    const day = applyDailyPrompt(
      applyDailyPrompt(undefined, '2026-07-16', 'first-try'),
      '2026-07-16',
      'missed',
    )
    expect(day.prompts).toBe(2)
    expect(day.firstTrySuccesses).toBe(1)
  })
})

describe('PersistedComboStats', () => {
  it('records combo outcomes and the daily tick together', () => {
    const storage = new AppStorage(fakeKV())
    const stats = new PersistedComboStats(storage, () => '2026-07-16')

    stats.record(KEY, 'missed', 4200)
    stats.record(KEY, 'first-try', 1300)

    expect(stats.get(KEY)).toEqual({
      attempts: 2,
      firstTrySuccesses: 1,
      recentOutcomes: ['missed', 'first-try'],
      timeToCorrectMs: [4200, 1300],
    })
    expect(stats.recentHistory(KEY)).toEqual({ misses: 1, total: 2 })
    expect(storage.state.dailyRecords['2026-07-16']).toEqual({
      date: '2026-07-16',
      activeMinutes: 0,
      prompts: 2,
      firstTrySuccesses: 1,
    })
  })

  it('splits daily records across day boundaries', () => {
    const storage = new AppStorage(fakeKV())
    let today = '2026-07-16'
    const stats = new PersistedComboStats(storage, () => today)

    stats.record(KEY, 'first-try', 1000)
    today = '2026-07-17'
    stats.record(KEY, 'first-try', 1000)

    expect(storage.state.dailyRecords['2026-07-16']?.prompts).toBe(1)
    expect(storage.state.dailyRecords['2026-07-17']?.prompts).toBe(1)
  })

  // Milestone B at the unit level: misses recorded through one storage
  // instance still drive weighting and worst-chords through a fresh one.
  it('misses survive a "reload" and feed weighting + worst chords', () => {
    const kv = fakeKV()
    const before = new PersistedComboStats(new AppStorage(kv))
    before.record(KEY, 'missed', 5000)
    before.record(KEY, 'missed', 6000)

    const after = new PersistedComboStats(new AppStorage(kv))
    expect(after.recentHistory(KEY)).toEqual({ misses: 2, total: 2 })
    expect(comboWeight(after.recentHistory(KEY))).toBeGreaterThan(1)
    expect(rankWorstCombos([COMBO], after).map((w) => w.combo)).toEqual([COMBO])
  })
})
