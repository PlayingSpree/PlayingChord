import { describe, expect, it } from 'vitest'
import { ALL_PITCH_CLASSES, type ScaleTypeId } from '../theory'
import { shapeHand, type Combo } from './combos'
import { PASS_MIN_GRADE } from './stats'
import { DEFAULT_PRACTICE_SETTINGS } from './settings'
import {
  activeChordCount,
  canSetAside,
  chordOrderOf,
  chordPassList,
  chordsOpenedBefore,
  filterUnlockedCombos,
  INITIAL_UNLOCK_COUNT,
  initialProgress,
  isFullyUnlocked,
  isSetAside,
  MIN_ACTIVE_CHORDS,
  notPassedChordKeys,
  openChord,
  passesToNextUnlock,
  poolChordKey,
  recordChordAttempt,
  reconcileProgress,
  remapProgress,
  setAsideChord,
  unlockedChordKeys,
  type PresetProgressRecord,
} from './progress'

// A pool of `size` major chords with contiguous voicing combos each, like a
// real expansion (poolChords × voicingIds).
function combosOf(size: number, voicingIds: string[] = ['any']): Combo[] {
  return ALL_PITCH_CLASSES.slice(0, size).flatMap((root) =>
    voicingIds.map((voicingId) => ({
      root,
      typeId: 'maj' as const,
      voicingId,
    })),
  )
}

// The default learning window (§5.1).
const W = DEFAULT_PRACTICE_SETTINGS.learningAtOnce

function orderOf(size: number): string[] {
  return chordOrderOf(combosOf(size))
}

// Passes every unlocked chord except the given indices.
function passedExcept(
  record: PresetProgressRecord,
  ...except: number[]
): PresetProgressRecord {
  return {
    ...record,
    masteredIndices: Array.from(
      { length: record.unlockedCount },
      (_, i) => i,
    ).filter((i) => !except.includes(i)),
  }
}

describe('chordOrderOf (§5 unlock order)', () => {
  it('dedupes voicing combos to first-occurrence chord order', () => {
    const combos = combosOf(3, ['first-inversion', 'second-inversion'])
    expect(chordOrderOf(combos)).toEqual(['0:maj', '1:maj', '2:maj'])
  })

  it('keys chords by root and type, ignoring voicing', () => {
    expect(poolChordKey({ root: 4, typeId: 'min7' })).toBe('4:min7')
  })

  it('fifths mode reorders all 12 roots along the circle of fifths', () => {
    expect(chordOrderOf(combosOf(12), 'fifths')).toEqual(
      [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5].map((root) => `${root}:maj`),
    )
  })

  it('keys scales by root and scale type, ignoring shape', () => {
    expect(
      poolChordKey({
        kind: 'scale',
        root: 3,
        scaleTypeId: 'major',
        shapeId: 'updown-2',
        hand: 'rh',
      }),
    ).toBe('s:3:major')
  })

  it('keys mode orders scale roots by accidental count, per tonality', () => {
    const scales = (scaleTypeId: ScaleTypeId): Combo[] =>
      ALL_PITCH_CLASSES.map((root) => ({
        kind: 'scale',
        root,
        scaleTypeId,
        shapeId: 'up-1',
        hand: 'rh',
      }))
    const roots = (order: string[]) => order.map((key) => key.split(':')[1])
    // C G F D B♭ A E♭ E A♭ B D♭ F♯
    expect(roots(chordOrderOf(scales('major'), 'keys'))).toEqual([
      '0',
      '7',
      '5',
      '2',
      '10',
      '9',
      '3',
      '4',
      '8',
      '11',
      '1',
      '6',
    ])
    // A E D B G F♯ C C♯ F G♯ B♭ E♭
    expect(roots(chordOrderOf(scales('melodic-minor'), 'keys'))).toEqual([
      '9',
      '4',
      '2',
      '11',
      '7',
      '6',
      '0',
      '1',
      '5',
      '8',
      '10',
      '3',
    ])
  })

  it('keys mode keeps one root’s scale types together, in pool order', () => {
    const combos: Combo[] = ([0, 9] as const).flatMap((root) =>
      (['natural-minor', 'harmonic-minor'] as const).flatMap((scaleTypeId) =>
        (['up-1', 'block'] as const).map((shapeId) => ({
          kind: 'scale' as const,
          root,
          scaleTypeId,
          shapeId,
          hand: shapeHand(shapeId, 'rh'),
        })),
      ),
    )
    expect(chordOrderOf(combos, 'keys')).toEqual([
      's:9:natural-minor',
      's:9:harmonic-minor',
      's:0:natural-minor',
      's:0:harmonic-minor',
    ])
  })

  it('fifths mode keeps one root’s chord types in pool order', () => {
    const combos: Combo[] = ([0, 2, 7] as const).flatMap((root) =>
      (['maj', 'min'] as const).map((typeId) => ({
        root,
        typeId,
        voicingId: 'any',
      })),
    )
    expect(chordOrderOf(combos, 'fifths')).toEqual([
      '0:maj',
      '0:min',
      '7:maj',
      '7:min',
      '2:maj',
      '2:min',
    ])
  })
})

describe('initialProgress / reconcileProgress (§5)', () => {
  it('starts with the first 3 chords unlocked', () => {
    expect(initialProgress(12)).toEqual({
      unlockedCount: INITIAL_UNLOCK_COUNT,
      masteredIndices: [],
      setAsideIndices: [],
    })
  })

  it('clamps the initial unlock to a smaller pool', () => {
    expect(initialProgress(2).unlockedCount).toBe(2)
    expect(initialProgress(1).unlockedCount).toBe(1)
  })

  it('reconcile clamps unlockedCount to a shrunk pool', () => {
    const record: PresetProgressRecord = {
      unlockedCount: 9,
      masteredIndices: [0, 5, 8],
      setAsideIndices: [],
    }
    expect(reconcileProgress(record, 6, W)).toEqual({
      unlockedCount: 6,
      masteredIndices: [0, 5],
      setAsideIndices: [],
    })
  })

  it('reconcile never drops below a fresh start', () => {
    const record: PresetProgressRecord = {
      unlockedCount: 1,
      masteredIndices: [0],
      setAsideIndices: [],
    }
    // A window of 1 is already full with the two the floor reopens.
    expect(reconcileProgress(record, 12, 1).unlockedCount).toBe(
      INITIAL_UNLOCK_COUNT,
    )
  })

  it('reconcile dedupes and sorts passed indices', () => {
    const record: PresetProgressRecord = {
      unlockedCount: 5,
      masteredIndices: [3, 1, 3, 0],
      setAsideIndices: [],
    }
    expect(reconcileProgress(record, 12, W).masteredIndices).toEqual([0, 1, 3])
  })

  it('reconcile fills the window when a pool grows under a finished record', () => {
    // Fully unlocked and fully passed at 6; a library edit grows the pool.
    const record = passedExcept({
      unlockedCount: 6,
      masteredIndices: [],
      setAsideIndices: [],
    })
    expect(reconcileProgress(record, 10, W).unlockedCount).toBe(6 + W)
    expect(reconcileProgress(record, 7, W).unlockedCount).toBe(7)
  })

  it('reconcile heals a record stalled behind a set-aside chord', () => {
    const record: PresetProgressRecord = {
      unlockedCount: 4,
      masteredIndices: [0, 1, 2],
      setAsideIndices: [3],
    }
    expect(reconcileProgress(record, 12, W).unlockedCount).toBe(4 + W)
  })

  it('reconcile tops a record up to a raised window, and never closes for a lowered one', () => {
    const record = passedExcept(
      { unlockedCount: 6, masteredIndices: [], setAsideIndices: [] },
      4,
      5,
    )
    expect(reconcileProgress(record, 12, 5).unlockedCount).toBe(9)
    expect(reconcileProgress(record, 12, 1)).toEqual(record)
  })

  it('a fresh preset opens as many as a window wider than the initial count', () => {
    expect(reconcileProgress(initialProgress(12), 12, 5).unlockedCount).toBe(5)
    expect(reconcileProgress(initialProgress(12), 12, 1).unlockedCount).toBe(
      INITIAL_UNLOCK_COUNT,
    )
  })
})

describe('remapProgress (§5.1 custom-preset edit)', () => {
  // A window of 1 keeps the settle out of the way where only the marks matter.
  it('moves marks with their items when one is removed from the middle', () => {
    const record: PresetProgressRecord = {
      unlockedCount: 4,
      masteredIndices: [0, 2],
      setAsideIndices: [1],
    }
    // b is removed: its set-aside goes with it, c's pass moves up to 1.
    expect(
      remapProgress(['a', 'b', 'c', 'd', 'e'], ['a', 'c', 'd', 'e'], record, 1),
    ).toEqual({
      unlockedCount: 3,
      masteredIndices: [0, 1],
      setAsideIndices: [],
    })
  })

  it('keeps an item unlocked when it moves past the frontier', () => {
    const record: PresetProgressRecord = {
      unlockedCount: 3,
      masteredIndices: [0, 1],
      setAsideIndices: [],
    }
    // a moves to 4, so the frontier reaches it and opens d and e, not passed.
    expect(
      remapProgress(
        ['a', 'b', 'c', 'd', 'e', 'f'],
        ['b', 'c', 'd', 'e', 'a', 'f'],
        record,
        W,
      ),
    ).toEqual({
      unlockedCount: 5,
      masteredIndices: [0, 4],
      setAsideIndices: [],
    })
  })

  it('leaves a record alone when the order is unchanged', () => {
    const order = orderOf(8)
    const record: PresetProgressRecord = {
      unlockedCount: 5,
      masteredIndices: [0, 3],
      setAsideIndices: [1],
    }
    expect(remapProgress(order, order, record, 1)).toEqual(record)
  })
})

describe('unlockedChordKeys / filterUnlockedCombos (§5 gating)', () => {
  it('exposes only the first unlockedCount chords', () => {
    const order = orderOf(6)
    const unlocked = unlockedChordKeys(order, initialProgress(6))
    expect([...unlocked]).toEqual(['0:maj', '1:maj', '2:maj'])
  })

  it('filters an expansion down to unlocked combos', () => {
    const combos = combosOf(6, ['first-inversion', 'second-inversion'])
    const unlocked = unlockedChordKeys(chordOrderOf(combos), initialProgress(6))
    const filtered = filterUnlockedCombos(combos, unlocked)
    expect(filtered).toHaveLength(6) // 3 chords × 2 voicings
    expect(filtered.every((c) => unlocked.has(poolChordKey(c)))).toBe(true)
  })

  it('falls back to the whole pool rather than returning empty', () => {
    const combos = combosOf(3)
    expect(filterUnlockedCombos(combos, new Set())).toEqual(combos)
  })

  it('isFullyUnlocked once the count covers the pool', () => {
    const order = orderOf(3)
    expect(isFullyUnlocked(order, initialProgress(3))).toBe(true)
    expect(isFullyUnlocked(orderOf(4), initialProgress(4))).toBe(false)
  })
})

describe('notPassedChordKeys (§5.1 Learn-mode gating)', () => {
  it('excludes passed chords from the unlocked set', () => {
    const order = orderOf(6)
    const record = passedExcept(
      { unlockedCount: 6, masteredIndices: [], setAsideIndices: [] },
      1,
      4,
    )
    expect([...notPassedChordKeys(order, record)]).toEqual(['1:maj', '4:maj'])
  })

  it('excludes locked chords too, like unlockedChordKeys', () => {
    const order = orderOf(6)
    const record: PresetProgressRecord = {
      unlockedCount: 3,
      masteredIndices: [0],
      setAsideIndices: [],
    }
    expect([...notPassedChordKeys(order, record)]).toEqual(['1:maj', '2:maj'])
  })

  it('is empty once every unlocked chord is passed', () => {
    const order = orderOf(3)
    const record: PresetProgressRecord = {
      unlockedCount: 3,
      masteredIndices: [0, 1, 2],
      setAsideIndices: [],
    }
    expect(notPassedChordKeys(order, record).size).toBe(0)
  })
})

describe('chordPassList (§7 unlock chip drill-down)', () => {
  it('tags each chord locked, unlocked, passed or set aside', () => {
    const order = orderOf(4)
    const record = passedExcept(
      { unlockedCount: 3, masteredIndices: [], setAsideIndices: [2] },
      1,
    )
    expect(chordPassList(order, record)).toEqual([
      { key: '0:maj', index: 0, unlocked: true, passed: true, setAside: false },
      {
        key: '1:maj',
        index: 1,
        unlocked: true,
        passed: false,
        setAside: false,
      },
      { key: '2:maj', index: 2, unlocked: true, passed: true, setAside: true },
      {
        key: '3:maj',
        index: 3,
        unlocked: false,
        passed: false,
        setAside: false,
      },
    ])
  })
})

describe('set aside / open by hand (§5.2)', () => {
  const order = orderOf(12)
  // Six unlocked, so there is room to set one aside above the floor.
  const six = (setAsideIndices: number[] = []): PresetProgressRecord => ({
    unlockedCount: 6,
    masteredIndices: [],
    setAsideIndices,
  })

  it('holds a set-aside chord out of the in-play set', () => {
    const record = six([1, 4])
    expect([...unlockedChordKeys(order, record)]).toEqual([
      '0:maj',
      '2:maj',
      '3:maj',
      '5:maj',
    ])
    expect(activeChordCount(record)).toBe(4)
    expect(isSetAside(order, record, '1:maj')).toBe(true)
    expect(isSetAside(order, record, '2:maj')).toBe(false)
  })

  it('holds it out of the not-passed narrow too', () => {
    const record = { ...six([1]), masteredIndices: [0] }
    expect([...notPassedChordKeys(order, record)]).toEqual([
      '2:maj',
      '3:maj',
      '4:maj',
      '5:maj',
    ])
  })

  it('refuses to leave fewer than MIN_ACTIVE_CHORDS in play', () => {
    const record = six([0, 1, 2])
    expect(activeChordCount(record)).toBe(MIN_ACTIVE_CHORDS)
    expect(canSetAside(order, record, '3:maj')).toBe(false)
    expect(setAsideChord(order, record, '3:maj', W)).toBe(record)
  })

  it('refuses a locked or already set-aside chord', () => {
    const record = six([1])
    expect(canSetAside(order, record, '1:maj')).toBe(false)
    expect(canSetAside(order, record, '9:maj')).toBe(false)
  })

  it('a fresh preset has nothing to spare (initial unlock is the floor)', () => {
    const fresh = initialProgress(12)
    expect(fresh.setAsideIndices).toEqual([])
    expect(canSetAside(order, fresh, '0:maj')).toBe(false)
  })

  it('setting aside keeps the list sorted and passing untouched', () => {
    const record = setAsideChord(order, six([4]), '1:maj', W)
    expect(record.setAsideIndices).toEqual([1, 4])
    expect(record.unlockedCount).toBe(6)
    expect(record.masteredIndices).toEqual([])
  })

  it('openChord brings a set-aside chord back', () => {
    const record = openChord(order, six([1, 4]), '1:maj')
    expect(record.setAsideIndices).toEqual([4])
    expect(record.unlockedCount).toBe(6)
  })

  it('openChord drags the frontier over a locked chord, and everything before it', () => {
    const record = openChord(order, six(), '8:maj')
    expect(record.unlockedCount).toBe(9)
    // Newly opened chords are unlocked and not yet passed, so the next
    // automatic batch now waits on them.
    expect(record.masteredIndices).toEqual([])
    expect(chordsOpenedBefore(order, six(), '8:maj')).toBe(2)
    expect(chordsOpenedBefore(order, six(), '2:maj')).toBe(0)
  })

  it('openChord is a no-op on a chord already in play, or off the pool', () => {
    const record = six([1])
    expect(openChord(order, record, '2:maj')).toBe(record)
    expect(openChord(order, record, '0:min')).toBe(record)
  })

  it('setting aside a chord still waiting opens the next in its place', () => {
    const record = passedExcept(
      { unlockedCount: 6, masteredIndices: [], setAsideIndices: [] },
      3,
      4,
      5,
    )
    const next = setAsideChord(order, record, '3:maj', W)
    expect(next.setAsideIndices).toEqual([3])
    expect(next.unlockedCount).toBe(7)
  })

  it('setting aside a passed chord opens nothing', () => {
    const record = passedExcept(
      { unlockedCount: 6, masteredIndices: [], setAsideIndices: [] },
      3,
      4,
      5,
    )
    expect(setAsideChord(order, record, '0:maj', W).unlockedCount).toBe(6)
  })

  it('setting aside in a fully unlocked pool has nothing to open', () => {
    const small = orderOf(4)
    const record = passedExcept(
      { unlockedCount: 4, masteredIndices: [], setAsideIndices: [] },
      3,
    )
    expect(setAsideChord(small, record, '3:maj', W).unlockedCount).toBe(4)
  })

  it('a set-aside chord does not hold up the next unlock', () => {
    // Every unlocked chord passed except the one that was benched.
    const record: PresetProgressRecord = {
      unlockedCount: 6,
      masteredIndices: [0, 1, 2, 3],
      setAsideIndices: [4],
    }
    const update = recordChordAttempt(order, record, '5:maj', 'B', W)
    expect(update.justUnlocked).toBe(true)
    expect(update.record.unlockedCount).toBe(6 + W)
    expect(update.record.setAsideIndices).toEqual([4])
  })

  it('reconcile drops set-aside indices a shrunk pool can no longer afford', () => {
    const record: PresetProgressRecord = {
      unlockedCount: 9,
      masteredIndices: [],
      setAsideIndices: [1, 7, 8],
    }
    // Pool of 3: the frontier clamps to 3, taking 7 and 8 with it, and the
    // floor then brings 1 back — 3 must stay in play.
    expect(reconcileProgress(record, 3, W)).toEqual({
      unlockedCount: 3,
      masteredIndices: [],
      setAsideIndices: [],
    })
  })

  it('reconcile keeps a set-aside chord the pool can still afford', () => {
    const record: PresetProgressRecord = {
      unlockedCount: 6,
      masteredIndices: [],
      setAsideIndices: [1, 3.5 as number, -1],
    }
    expect(reconcileProgress(record, 12, W).setAsideIndices).toEqual([1])
  })
})

describe('recordChordAttempt (§5.1 pass and unlock)', () => {
  const order = orderOf(12)
  const fresh = initialProgress(12)

  it('a grade at the pass bar passes the chord and opens the next', () => {
    const { record, changed, justUnlocked } = recordChordAttempt(
      order,
      fresh,
      '0:maj',
      PASS_MIN_GRADE,
      W,
    )
    expect(changed).toBe(true)
    expect(justUnlocked).toBe(true)
    expect(record.masteredIndices).toEqual([0])
    expect(record.unlockedCount).toBe(INITIAL_UNLOCK_COUNT + 1)
  })

  it('every grade above the bar passes too', () => {
    for (const grade of ['C', 'B', 'A', 'S'] as const) {
      expect(recordChordAttempt(order, fresh, '0:maj', grade, W).changed).toBe(
        true,
      )
    }
  })

  it('an F does not pass, and neither does no grade at all', () => {
    expect(recordChordAttempt(order, fresh, '0:maj', 'F', W).changed).toBe(
      false,
    )
    expect(recordChordAttempt(order, fresh, '0:maj', null, W).record).toBe(
      fresh,
    )
  })

  it('a locked or unknown chord does not count', () => {
    expect(recordChordAttempt(order, fresh, '5:maj', 'S', W).changed).toBe(
      false,
    )
    expect(recordChordAttempt(order, fresh, '0:min', 'S', W).changed).toBe(
      false,
    )
  })

  it('an already-passed chord is a no-op', () => {
    const once = recordChordAttempt(order, fresh, '1:maj', 'S', W)
    const twice = recordChordAttempt(order, once.record, '1:maj', 'S', W)
    expect(twice.changed).toBe(false)
  })

  it('each pass opens one, keeping the window full', () => {
    let record = fresh
    for (const [i, key] of ['0:maj', '1:maj', '2:maj', '3:maj'].entries()) {
      record = recordChordAttempt(order, record, key, 'B', W).record
      expect(record.unlockedCount).toBe(INITIAL_UNLOCK_COUNT + i + 1)
      expect(record.unlockedCount - record.masteredIndices.length).toBe(W)
    }
  })

  it('a pass opens nothing while chords opened by hand crowd the window', () => {
    const record: PresetProgressRecord = {
      unlockedCount: 6,
      masteredIndices: [],
      setAsideIndices: [],
    }
    const update = recordChordAttempt(order, record, '0:maj', 'B', W)
    expect(update.changed).toBe(true)
    expect(update.justUnlocked).toBe(false)
    expect(update.record.unlockedCount).toBe(6)
  })

  it('a wider window opens more per pass only to refill it', () => {
    const update = recordChordAttempt(order, fresh, '0:maj', 'B', 5)
    // Two waiting, five wanted: three open.
    expect(update.record.unlockedCount).toBe(6)
  })

  it('unlocking clamps at the end of the pool', () => {
    const order4 = orderOf(4)
    const record = passedExcept(initialProgress(4), 2)
    const update = recordChordAttempt(order4, record, '2:maj', 'B', W)
    expect(update.justUnlocked).toBe(true)
    expect(update.record.unlockedCount).toBe(4)
  })

  it('a fully-unlocked pool still records a pass but never grows', () => {
    const order3 = orderOf(3)
    const record = passedExcept(initialProgress(3), 2)
    const update = recordChordAttempt(order3, record, '2:maj', 'B', W)
    expect(update.changed).toBe(true)
    expect(update.justUnlocked).toBe(false)
    expect(update.record.unlockedCount).toBe(3)
  })
})

describe('passesToNextUnlock (§5.1 Home line)', () => {
  const order = orderOf(12)

  it('is one pass while the window is full', () => {
    expect(passesToNextUnlock(order, initialProgress(12), W)).toBe(1)
  })

  it('counts the passes chords opened by hand add', () => {
    const record: PresetProgressRecord = {
      unlockedCount: 6,
      masteredIndices: [0],
      setAsideIndices: [],
    }
    // Five waiting against a window of three: three passes, and the third opens.
    expect(passesToNextUnlock(order, record, W)).toBe(3)
  })

  it('is zero once everything is open', () => {
    const record = { ...initialProgress(3), masteredIndices: [] }
    expect(passesToNextUnlock(orderOf(3), record, W)).toBe(0)
  })
})
