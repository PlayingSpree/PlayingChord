import { describe, expect, it } from 'vitest'
import { BUILT_IN_VOICING_LIBRARY, type PitchClass } from '../theory'
import {
  carryProgressAcrossEdit,
  createPoolResolver,
  type PoolResolver,
  type PoolSources,
} from './pool'
import { builtInPresets, builtInScalePresets, type Preset } from './presets'
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

  it('unlocks scale presets by accidental count, whatever the setting', () => {
    for (const unlockByFifths of [false, true]) {
      const pool = setup({
        presets: () => builtInScalePresets(),
        unlockByFifths: () => unlockByFifths,
      }).resolve('major-scales', 0)
      // C G F — F major's one flat opens before D's two sharps.
      expect(pool.chordOrder.slice(0, 4)).toEqual([
        's:0:major',
        's:7:major',
        's:5:major',
        's:2:major',
      ])
      // In play keeps pool order; which three are open is the unlock order's.
      expect(pool.inPlay.map((combo) => pool.comboLabel(combo))).toEqual([
        'C major',
        'F major',
        'G major',
      ])
    }
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

describe('carryProgressAcrossEdit (§5.1)', () => {
  const explicit = (roots: PitchClass[]): Preset => ({
    id: 'mine',
    name: 'Mine',
    pool: {
      kind: 'explicit',
      chords: roots.map((root) => ({ root, typeId: 'maj' })),
    },
    voicingIds: ['any'],
  })
  const lib = BUILT_IN_VOICING_LIBRARY

  it('keeps a pass on its chord when an edit removes one before it', () => {
    // C D E F with E passed; D is removed, so E now sits at 1.
    const record: PresetProgressRecord = {
      unlockedCount: 4,
      masteredIndices: [2],
      setAsideIndices: [],
    }
    expect(
      carryProgressAcrossEdit(
        { preset: explicit([0, 2, 4, 5]), voicings: lib },
        { preset: explicit([0, 4, 5]), voicings: lib },
        record,
        false,
      ),
    ).toEqual({ unlockedCount: 3, masteredIndices: [1], setAsideIndices: [] })
  })

  it('carries a diatonic pool by position, like a key change', () => {
    const diatonic = (key: PitchClass): Preset => ({
      id: 'mine',
      name: 'Mine',
      pool: { kind: 'diatonic', key },
      voicingIds: ['any'],
    })
    const record: PresetProgressRecord = {
      unlockedCount: 4,
      masteredIndices: [0, 1],
      setAsideIndices: [],
    }
    expect(
      carryProgressAcrossEdit(
        { preset: diatonic(0), voicings: lib },
        { preset: diatonic(7), voicings: lib },
        record,
        false,
      ),
    ).toBe(record)
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

  it('labels a scale by its name', () => {
    const pool = setup({ presets: () => builtInScalePresets() }).resolve(
      'minor-scales',
      0,
    )
    expect(pool.label('s:3:harmonic-minor')).toBe('E♭ harmonic minor')
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

  it('reads a barely-played chord as `pending` rather than F (§7.5)', () => {
    const { resolve, stats } = setup()
    stats.record('0:maj:any', 'missed', 9000)
    expect(resolve('triads', 0).displayGrade('0:maj')).toBe('pending')
  })

  it('takes an alternate source, which is how the learn loop grades (§5.4)', () => {
    const { resolve, stats } = setup()
    reps(stats, '0:maj:any', 0) // a lifetime record…
    const session = new InMemoryComboStats() // …and nothing this session
    const pool = resolve('triads', 0)
    expect(pool.chordGrade('0:maj')).not.toBeNull()
    expect(pool.chordGrade('0:maj', session)).toBeNull()
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

  it('counts a not-yet-passed chord as worth drilling (§5.1)', () => {
    // A clean sheet is not the same as a proven one — most likely the chord
    // has barely been played, and leaving it out would mean the toggle could
    // only revisit old mistakes and never the gaps.
    expect(setup().resolve('triads', 0).worstOnly()).not.toEqual([])
  })

  it('reads worst-only from the records, not from a session (§7.2)', () => {
    // The sheet asks this from Home, before any prompt exists — so what
    // answers is yesterday's persisted misses, not what this page load dealt.
    const { resolve, stats } = setup()
    stats.record('0:maj:any', 'missed', 9000)
    stats.record('0:maj:any', 'first-try', 1000)
    const pool = resolve('triads', 0)
    const passed = pool.withProgress({
      ...opened(pool.progressRecord),
      masteredIndices: [0, 1, 2, 3, 4, 5],
    })
    expect(passed.worstOnly().map(poolChordKey)).toEqual(['0:maj'])
  })

  it('answers for the preset asked about, not the active one (§7.2)', () => {
    // The session sheet's picks are a draft: it asks about the preset the
    // player just selected in it, which the store hasn't switched to.
    const other: Preset = {
      id: 'other',
      name: 'Other',
      pool: { kind: 'explicit', chords: [{ root: 5, typeId: 'min' }] },
      voicingIds: ['any'],
    }
    const stats = new InMemoryComboStats()
    stats.record('5:min:any', 'missed', 9000)
    const resolve = createPoolResolver({
      presets: () => [TRIADS, other],
      voicings: () => BUILT_IN_VOICING_LIBRARY,
      storedProgress: (id) =>
        id === 'triads'
          ? {
              unlockedCount: 6,
              masteredIndices: [0, 1, 2, 3, 4, 5],
              setAsideIndices: [],
            }
          : null,
      unlockByFifths: () => false,
      stats,
    })
    expect(resolve('triads', 0).worstOnly()).toEqual([])
    expect(resolve('other', 0).worstOnly()).not.toEqual([])
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
    // chords not yet passed.
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

  it('grades the pass list on this pool’s combos only (§5.1/§7.1)', () => {
    const { resolve, stats } = setup()
    // C major missed over and over in a voicing this pool doesn't list —
    // another preset's, or a deleted rule's.
    for (let i = 0; i < 10; i++) stats.record('0:maj:rootless', 'missed', 9000)
    const pool = resolve('triads', 0)
    expect(pool.passList()[0]?.grade).toBeNull()
    expect(pool.chordGrade('0:maj')).toBeNull()

    stats.record('0:maj:any', 'missed', 9000)
    expect(pool.passList()[0]?.grade).toBe(pool.displayGrade('0:maj'))
    expect(pool.passList()[0]?.grade).not.toBeNull()
  })

  it('passes a chord whose grade reaches the bar, and opens the batch it completes', () => {
    const { resolve, stats } = setup()
    const pool = resolve('triads', 0)
    // Not a pass without a grade.
    expect(pool.pass('0:maj')).toBe(pool)
    for (const key of ['0:maj', '2:maj', '4:maj']) {
      for (let i = 0; i < 5; i++) stats.record(`${key}:any`, 'first-try', 500)
    }
    const once = pool.pass('0:maj').pass('2:maj')
    expect(once.progressRecord.masteredIndices).toEqual([0, 1])
    expect(once.openedSince(pool)).toEqual([])
    // Already passed: nothing moves.
    expect(once.pass('0:maj')).toBe(once)
    expect(once.pass('4:maj').openedSince(once)).toEqual(['5:maj', '7:maj'])
  })

  it('grades a pass on the records it is given (§5.4)', () => {
    const { resolve } = setup()
    const pool = resolve('triads', 0)
    const session = new InMemoryComboStats()
    for (let i = 0; i < 5; i++) session.record('0:maj:any', 'first-try', 500)
    expect(pool.pass('0:maj')).toBe(pool)
    expect(pool.pass('0:maj', session).progressRecord.masteredIndices).toEqual([
      0,
    ])
  })

  it('keeps a learn set to what is in play, in unlock order (§5.4)', () => {
    const pool = setup().resolve('triads', 0)
    expect(pool.sanitizeLearnSet(['4:maj', '9:maj', '0:maj', 'gone'])).toEqual([
      '0:maj',
      '4:maj',
    ])
  })

  it('sets a chord aside only while enough stays in play (§5.2)', () => {
    const pool = setup().resolve('triads', 0)
    // Three in play is the floor, so nothing can go.
    expect(pool.setAside('0:maj')).toBe(pool)
    const open = pool.withProgress(opened(pool.progressRecord))
    expect(open.setAside('0:maj').progressRecord.setAsideIndices).toEqual([0])
  })

  it('reads back the batch that setting aside the last waiting chord opens', () => {
    const pool = setup().resolve('triads', 0)
    const waiting = pool.withProgress({
      unlockedCount: 4,
      masteredIndices: [0, 1, 2],
      setAsideIndices: [],
    })
    expect(waiting.setAside('5:maj').openedSince(waiting)).toEqual([
      '7:maj',
      '9:maj',
    ])
  })

  it('opens a locked chord with the ones ahead of it (§5.1)', () => {
    const pool = setup().resolve('triads', 0)
    expect(pool.open('7:maj').openedSince(pool)).toEqual(['5:maj', '7:maj'])
    // Already in play: nothing moves.
    expect(pool.open('0:maj')).toBe(pool)
  })

  it('compares frontiers by chord, not by place', () => {
    const byPool = setup().resolve('triads', 0)
    // By fifths the first three are C G D where the pool's own order has
    // C D E: only G is new, whatever position it sits at.
    const byFifths = setup({ unlockByFifths: () => true }).resolve('triads', 0)
    expect(byFifths.openedSince(byPool)).toEqual(['7:maj'])
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
