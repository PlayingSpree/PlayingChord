import { describe, expect, it } from 'vitest'
import { comboWeight, rankWorstCombos, type Combo } from '../practice'
import { AppStorage, type KeyValueStore } from './appStorage'
import {
  applyDailyPrompt,
  InMemoryBestCombo,
  InMemoryDailyActivity,
  PersistedBestCombo,
  PersistedComboStats,
  PersistedDailyActivity,
} from './persistedStats'

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
    expect(
      applyDailyPrompt(undefined, '2026-07-16', 'first-try', 1500),
    ).toEqual({
      date: '2026-07-16',
      activeMinutes: 0,
      prompts: 1,
      firstTrySuccesses: 1,
      timeToCorrectMs: 1500,
    })
  })

  it('accumulates prompts, first-try successes and time-to-correct', () => {
    const day = applyDailyPrompt(
      applyDailyPrompt(undefined, '2026-07-16', 'first-try', 1000),
      '2026-07-16',
      'missed',
      4000,
    )
    expect(day.prompts).toBe(2)
    expect(day.firstTrySuccesses).toBe(1)
    expect(day.timeToCorrectMs).toBe(5000)
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
      timeToCorrectMs: 5500,
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

  it('a null-time record (§6.5 Song bar) skips the daily tick', () => {
    const storage = new AppStorage(fakeKV())
    const stats = new PersistedComboStats(storage, () => '2026-07-18')

    stats.record(KEY, 'missed', null)
    stats.record(KEY, 'first-try', null)

    expect(stats.get(KEY)).toEqual({
      attempts: 2,
      firstTrySuccesses: 1,
      recentOutcomes: ['missed', 'first-try'],
      timeToCorrectMs: [],
    })
    expect(storage.state.dailyRecords['2026-07-18']).toBeUndefined()

    // A numeric record still ticks both.
    stats.record(KEY, 'first-try', 900)
    expect(storage.state.dailyRecords['2026-07-18']?.prompts).toBe(1)
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

describe('PersistedDailyActivity (§7 active minutes)', () => {
  it('accrues minutes onto today, alongside prompt ticks', () => {
    const storage = new AppStorage(fakeKV())
    const stats = new PersistedComboStats(storage, () => '2026-07-16')
    const activity = new PersistedDailyActivity(storage, () => '2026-07-16')

    stats.record(KEY, 'first-try', 1000)
    activity.addMinutes(0.5)
    activity.addMinutes(2)

    expect(activity.todayMinutes()).toBe(2.5)
    expect(storage.state.dailyRecords['2026-07-16']).toMatchObject({
      activeMinutes: 2.5,
      prompts: 1,
    })
  })

  it('opens a day that has activity but no prompts yet', () => {
    const storage = new AppStorage(fakeKV())
    const activity = new PersistedDailyActivity(storage, () => '2026-07-16')
    activity.addMinutes(1)
    expect(storage.state.dailyRecords['2026-07-16']).toEqual({
      date: '2026-07-16',
      activeMinutes: 1,
      prompts: 0,
      firstTrySuccesses: 0,
      timeToCorrectMs: 0,
    })
  })

  it('ignores non-positive and junk amounts', () => {
    const storage = new AppStorage(fakeKV())
    const activity = new PersistedDailyActivity(storage, () => '2026-07-16')
    activity.addMinutes(0)
    activity.addMinutes(-5)
    activity.addMinutes(NaN)
    expect(storage.state.dailyRecords['2026-07-16']).toBeUndefined()
  })

  it('splits across the day rollover and survives a reload', () => {
    const kv = fakeKV()
    let today = '2026-07-16'
    const activity = new PersistedDailyActivity(new AppStorage(kv), () => today)
    activity.addMinutes(3)
    today = '2026-07-17'
    activity.addMinutes(4)
    expect(activity.todayMinutes()).toBe(4)

    const reloaded = new PersistedDailyActivity(new AppStorage(kv), () => today)
    expect(reloaded.records()['2026-07-16']?.activeMinutes).toBe(3)
    expect(reloaded.todayMinutes()).toBe(4)
  })

  it('the in-memory double behaves the same', () => {
    const activity = new InMemoryDailyActivity(() => '2026-07-16')
    activity.addMinutes(1.5)
    activity.addMinutes(-1)
    expect(activity.todayMinutes()).toBe(1.5)
    expect(activity.records()['2026-07-16']?.prompts).toBe(0)
  })
})

describe('PersistedBestCombo (§7 lifetime combo streak)', () => {
  it('raises the persisted best when beaten, survives a reload', () => {
    const kv = fakeKV()
    const bestCombo = new PersistedBestCombo(new AppStorage(kv))
    bestCombo.record(3)
    bestCombo.record(12)

    const reloaded = new PersistedBestCombo(new AppStorage(kv))
    reloaded.record(5) // below the persisted best: no-op
    expect(new AppStorage(kv).state.bestComboStreak).toBe(12)
  })

  it('the in-memory double keeps the running max', () => {
    const bestCombo = new InMemoryBestCombo()
    bestCombo.record(4)
    bestCombo.record(2)
    bestCombo.record(9)
    expect(bestCombo.best()).toBe(9)
  })
})
