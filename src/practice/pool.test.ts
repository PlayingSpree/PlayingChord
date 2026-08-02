import { describe, expect, it } from 'vitest'
import { BUILT_IN_VOICING_LIBRARY, type PitchClass } from '../theory'
import { createPoolResolver, type PoolResolver, type PoolSources } from './pool'
import { builtInPresets, type Preset } from './presets'
import {
  initialProgress,
  poolChordKey,
  type PresetProgressRecord,
} from './progress'
import { InMemoryComboStats } from './stats'
import type { SessionEvent } from './session'

// Six roots × one type × one voicing, so a chord and a combo are the same thing
// and the unlock order is C D E F G A — big enough that the initial unlock
// count (3) still leaves half of it locked.
const TRIADS: Preset = {
  id: 'triads',
  name: 'Triads',
  pool: { kind: 'product', roots: [0, 2, 4, 5, 7, 9], chordTypes: ['maj'] },
  voicingIds: ['any'],
}

const ALL_KEYS = ['0:maj', '2:maj', '4:maj', '5:maj', '7:maj', '9:maj']

// Expands to nothing: its voicing id doesn't exist in the library.
const BROKEN: Preset = {
  id: 'broken',
  name: 'Broken',
  pool: { kind: 'product', roots: [0], chordTypes: ['maj'] },
  voicingIds: ['no-such-rule'],
}

const setup = (overrides: Partial<PoolSources> = {}) => {
  const stats = new InMemoryComboStats()
  const stored = new Map<string, PresetProgressRecord>()
  const resolve: PoolResolver = createPoolResolver({
    presets: () => [TRIADS, BROKEN],
    voicings: () => BUILT_IN_VOICING_LIBRARY,
    storedProgress: (id) => stored.get(id) ?? null,
    unlockByFifths: () => false,
    stats,
    ...overrides,
  })
  return { resolve, stats, stored }
}

// Open the whole pool, so a narrowing has something to narrow.
const opened = (record: PresetProgressRecord): PresetProgressRecord => ({
  ...record,
  unlockedCount: 6,
})

describe('pool resolution (§4/§5.1)', () => {
  it('expands the named preset and orders its chords for the unlock queue', () => {
    const pool = setup().resolve('triads', 0)
    expect(pool.presetId).toBe('triads')
    expect(pool.combos).toHaveLength(6)
    expect(pool.chordOrder).toEqual(ALL_KEYS)
  })

  it('falls back to the first preset when the named one is unknown', () => {
    expect(setup().resolve('nope', 0).presetId).toBe('triads')
  })

  it('falls back when a preset expands to nothing', () => {
    // A custom preset whose rules were edited out from under it (§4).
    expect(setup().resolve('broken', 0).presetId).toBe('triads')
  })

  it('starts a preset with no stored progress at the initial unlock count', () => {
    const pool = setup().resolve('triads', 0)
    expect(pool.progressRecord).toEqual(initialProgress(6))
    expect(pool.reconciled).toBe(false)
  })

  it('flags a stored record that reconciliation had to change', () => {
    const { resolve, stored } = setup()
    // Saved when the pool was larger — more unlocked than it now holds.
    stored.set('triads', { ...initialProgress(12), unlockedCount: 12 })
    const pool = resolve('triads', 0)
    expect(pool.progressRecord.unlockedCount).toBe(6)
    expect(pool.reconciled).toBe(true)
  })

  it('leaves a record that survives reconciliation unflagged', () => {
    const { resolve, stored } = setup()
    stored.set('triads', { ...initialProgress(6), unlockedCount: 4 })
    const pool = resolve('triads', 0)
    expect(pool.progressRecord.unlockedCount).toBe(4)
    expect(pool.reconciled).toBe(false)
  })

  it('orders by the circle of fifths only when the setting asks (§5.1)', () => {
    const plain = setup().resolve('triads', 0)
    const fifths = setup({ unlockByFifths: () => true }).resolve('triads', 0)
    expect(plain.chordOrder).toEqual(ALL_KEYS)
    // Same chords, ordered by fifths distance rather than by the pool.
    expect(new Set(fifths.chordOrder)).toEqual(new Set(ALL_KEYS))
    expect(fifths.chordOrder).not.toEqual(ALL_KEYS)
  })

  it('spells a diatonic preset through its key (§3.5)', () => {
    const diatonic = createPoolResolver({
      presets: (key: PitchClass) => builtInPresets(key),
      voicings: () => BUILT_IN_VOICING_LIBRARY,
      storedProgress: () => null,
      unlockByFifths: () => false,
      stats: new InMemoryComboStats(),
    })
    // F major's diatonic chords include B♭, which the default spelling calls A♯.
    const pool = diatonic('diatonic', 5)
    const labels = pool.chordOrder.map((key) => pool.label(key))
    expect(labels.some((label) => label.startsWith('B♭'))).toBe(true)
    expect(labels.some((label) => label.startsWith('A♯'))).toBe(false)
  })
})

describe('pool identity under a moved record (§5.1)', () => {
  it('withProgress leaves the original untouched', () => {
    const pool = setup().resolve('triads', 0)
    const next = pool.withProgress(opened(pool.progressRecord))
    expect(pool.progressRecord.unlockedCount).toBe(3)
    expect(next.progressRecord.unlockedCount).toBe(6)
    expect(next.presetId).toBe(pool.presetId)
  })

  it('re-derives what is in play rather than carrying it over', () => {
    const pool = setup().resolve('triads', 0)
    expect(pool.inPlay).toHaveLength(3)
    expect(pool.withProgress(opened(pool.progressRecord)).inPlay).toHaveLength(
      6,
    )
  })

  it('is not a reconciliation', () => {
    const { resolve, stored } = setup()
    stored.set('triads', { ...initialProgress(12), unlockedCount: 12 })
    const pool = resolve('triads', 0)
    expect(pool.reconciled).toBe(true)
    expect(pool.withProgress(pool.progressRecord).reconciled).toBe(false)
  })
})

describe('pool labels (§7)', () => {
  it('labels a chord-order key compactly', () => {
    expect(setup().resolve('triads', 0).label('0:maj')).toBe('C')
  })

  it('gives back a key it does not contain, so a stale selection survives', () => {
    expect(setup().resolve('triads', 0).label('11:dim7')).toBe('11:dim7')
  })
})

describe('pool grades (§5.1/§7.5)', () => {
  const reps = (stats: InMemoryComboStats, key: string, misses: number) => {
    for (let i = 0; i < misses; i += 1) stats.record(key, 'missed', 9000)
    for (let i = 0; i < 10 - misses; i += 1) stats.record(key, 'first-try', 900)
  }

  it('has no grade for a chord with no history', () => {
    expect(setup().resolve('triads', 0).chordGrade('0:maj')).toBeNull()
  })

  it('grades a chord once its combos have a record', () => {
    const { resolve, stats } = setup()
    reps(stats, '0:maj:any', 0)
    expect(resolve('triads', 0).chordGrade('0:maj')).not.toBeNull()
  })

  it('reads a barely-played chord as `new` rather than F (§7.5)', () => {
    const { resolve, stats } = setup()
    stats.record('0:maj:any', 'missed', 9000)
    expect(resolve('triads', 0).displayGrade('0:maj')).toBe('new')
  })

  it('takes an alternate source, which is how the learn loop grades (§5.4)', () => {
    const { resolve, stats } = setup()
    reps(stats, '0:maj:any', 0) // a lifetime record…
    const session = new InMemoryComboStats() // …and nothing this session
    const pool = resolve('triads', 0)
    expect(pool.chordGrade('0:maj')).not.toBeNull()
    expect(pool.chordGrade('0:maj', { source: session })).toBeNull()
  })

  it('swaps in a rep that has not been written yet (§7.3)', () => {
    const { resolve, stats } = setup()
    reps(stats, '0:maj:any', 10) // every rep missed
    const pool = resolve('triads', 0)
    const projected = pool.chordGrade('0:maj', {
      projected: {
        key: '0:maj:any',
        record: {
          attempts: 10,
          firstTrySuccesses: 10,
          recentOutcomes: Array<'first-try'>(10).fill('first-try'),
          timeToCorrectMs: [500],
        },
      },
    })
    expect(pool.chordGrade('0:maj')).toBe('F')
    expect(projected).not.toBe('F')
  })
})

describe('pool narrowings (§5/§5.4)', () => {
  it('in-play is the unlocked, un-benched chords', () => {
    const pool = setup().resolve('triads', 0)
    const open = pool.withProgress({
      ...opened(pool.progressRecord),
      setAsideIndices: [1],
    })
    expect(open.inPlay.map(poolChordKey)).toEqual([
      '0:maj',
      '4:maj',
      '5:maj',
      '7:maj',
      '9:maj',
    ])
  })

  it('worst-only leads with the missed chords', () => {
    const { resolve, stats } = setup()
    stats.record('4:maj:any', 'missed', 9000)
    const pool = resolve('triads', 0)
    const keys = pool
      .withProgress(opened(pool.progressRecord))
      .worstOnly()
      .map(poolChordKey)
    expect(keys[0]).toBe('4:maj')
    // Nothing is passed yet, so the rest still belong in the drill (§5.1).
    expect(new Set(keys)).toEqual(new Set(ALL_KEYS))
  })

  it('worst-only comes out empty when everything is passed and clean', () => {
    const pool = setup().resolve('triads', 0)
    const done = pool.withProgress({
      ...opened(pool.progressRecord),
      masteredIndices: [0, 1, 2, 3, 4, 5],
    })
    expect(done.worstOnly()).toEqual([])
  })

  it('the learn set is the selection plus its filler (§5.4)', () => {
    const pool = setup().resolve('triads', 0)
    const open = pool.withProgress({
      ...opened(pool.progressRecord),
      masteredIndices: [1, 2, 3, 4, 5],
    })
    const keys = open.learnSet(['0:maj']).map(poolChordKey)
    expect(keys).toContain('0:maj')
    // Padded up to three with chords already passed, never with unselected
    // chords still being learned.
    expect(keys).toHaveLength(3)
  })
})

describe('pool progress questions (§5.1/§5.2)', () => {
  it('lists every chord in unlock order with its label and status', () => {
    const list = setup().resolve('triads', 0).passList()
    expect(list.map((entry) => entry.label)).toEqual([
      'C',
      'D',
      'E',
      'F',
      'G',
      'A',
    ])
    expect(list.map((entry) => entry.unlocked)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
    ])
  })

  it('offers the learn picker only what is in play (§5.4)', () => {
    expect(
      setup()
        .resolve('triads', 0)
        .learnChoices()
        .map((entry) => entry.key),
    ).toEqual(['0:maj', '2:maj', '4:maj'])
  })

  it('names the benched chords for the Report offer (§5.2)', () => {
    const pool = setup().resolve('triads', 0)
    const benched = pool.withProgress({
      ...opened(pool.progressRecord),
      setAsideIndices: [2],
    })
    expect(benched.setAsideChords()).toEqual([
      { chordKey: '4:maj', label: 'E' },
    ])
  })

  it('says how many chords would open with a locked one (§5.1)', () => {
    const pool = setup().resolve('triads', 0)
    // F is the frontier, so A opens with the two ahead of it.
    expect(pool.openedWith('9:maj')).toBe(2)
    // An already-unlocked chord opens with nothing.
    expect(pool.openedWith('0:maj')).toBe(0)
  })
})

describe('pool report folds (§7.4)', () => {
  const event = (
    key: string,
    outcome: SessionEvent['outcome'],
  ): SessionEvent => ({ key, label: key, outcome, timeToCorrectMs: 1000 })

  it('folds a session log into per-chord lines, in the order first played', () => {
    const chords = setup()
      .resolve('triads', 0)
      .reportChords([
        event('2:maj:any', 'first-try'),
        event('0:maj:any', 'missed'),
        event('0:maj:any', 'missed'),
      ])
    expect(chords.map((c) => c.chordKey)).toEqual(['2:maj', '0:maj'])
    expect(chords.map((c) => c.label)).toEqual(['D', 'C'])
    expect(chords.map((c) => c.misses)).toEqual([0, 2])
  })

  it('ignores an event for a combo the pool no longer contains', () => {
    expect(
      setup()
        .resolve('triads', 0)
        .reportChords([event('11:dim7:any', 'missed')]),
    ).toEqual([])
  })
})
