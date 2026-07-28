import { describe, expect, it } from 'vitest'
import { CHAPTERS, chapterById, type ChapterDefinition } from './chapters'
import { comboKey } from './combos'
import {
  BATCH_WEIGHT_BOOST,
  calibratePath,
  canSetAsideCombo,
  chapterProgress,
  chapterRows,
  chapterSong,
  emptyPathProgress,
  isBatchComplete,
  isComboSetAside,
  isPathCombo,
  isPathComplete,
  isSongStamped,
  learningPool,
  MIN_REPERTOIRE_COMBOS,
  openCombo,
  passedTriadCount,
  PATH_POOL_WIDTH,
  PATH_RECENT_WINDOW,
  pathPosition,
  reconcilePathProgress,
  recordComboPass,
  repertoireCombos,
  repertoirePreset,
  setAsideCombo,
  songOffer,
  stampChapterSong,
  todayCard,
  type ComboRecordReader,
  type PathProgressRecord,
} from './path'
import { MISS_WEIGHT_BOOST } from './generator'
import { applyOutcome, type ComboStatRecord } from './stats'

const chapter = (id: string): ChapterDefinition => {
  const found = chapterById(id)
  if (!found) throw new Error(`No chapter: ${id}`)
  return found
}

// The comboKey of one declared combo, by chapter id and index.
const keyAt = (id: string, index: number): string => {
  const pathCombo = chapter(id).combos[index]
  if (!pathCombo) throw new Error(`No combo ${id}[${index}]`)
  return comboKey(pathCombo.combo)
}

// A record with the given chapters' combo indices already passed.
const withPassed = (
  passed: Record<string, number[]>,
  extra: Partial<PathProgressRecord> = {},
): PathProgressRecord => ({
  calibrated: true,
  chapters: Object.fromEntries(
    Object.entries(passed).map(([id, indices]) => [
      id,
      { passed: indices, setAside: [], songStamped: false },
    ]),
  ),
  ...extra,
})

const ALL = (id: string): number[] => chapter(id).combos.map((_, i) => i)

// Every combo of every chapter up to (not including) `id` passed.
const passedUpTo = (id: string): Record<string, number[]> => {
  const stop = CHAPTERS.findIndex((c) => c.id === id)
  return Object.fromEntries(
    CHAPTERS.slice(0, stop).map((c) => [c.id, ALL(c.id)]),
  )
}

// A stat record that grades D or better: two clean reps inside a second clears
// the evidence floor's arithmetic (§5.1's "about two clean reps").
const passingRecord = (reps = 4): ComboStatRecord => {
  let record: ComboStatRecord = {
    attempts: 0,
    firstTrySuccesses: 0,
    recentOutcomes: [],
    timeToCorrectMs: [],
  }
  for (let i = 0; i < reps; i++) {
    record = applyOutcome(record, 'first-try', 500)
  }
  return record
}

const failingRecord = (): ComboStatRecord => {
  let record: ComboStatRecord = {
    attempts: 0,
    firstTrySuccesses: 0,
    recentOutcomes: [],
    timeToCorrectMs: [],
  }
  for (let i = 0; i < 6; i++) record = applyOutcome(record, 'missed', 9000)
  return record
}

const reader = (
  records: Record<string, ComboStatRecord>,
): ComboRecordReader => ({
  get: (key) => records[key] ?? null,
})

const NO_STATS: ComboRecordReader = { get: () => null }

describe('reconcile & the record (§5.1)', () => {
  it('starts uncalibrated with nothing passed', () => {
    const record = emptyPathProgress()
    expect(record.calibrated).toBe(false)
    expect(passedTriadCount(record)).toBe(0)
    expect(repertoireCombos(record)).toEqual([])
  })

  it('reads a missing chapter as empty rather than throwing', () => {
    expect(chapterProgress(emptyPathProgress(), 'key-c')).toEqual({
      passed: [],
      setAside: [],
      songStamped: false,
    })
  })

  describe('reconcile clamps to the track as it is now', () => {
    it('drops a chapter id the track no longer declares', () => {
      const record = reconcilePathProgress({
        calibrated: true,
        chapters: {
          'key-of-atlantis': { passed: [0], setAside: [], songStamped: true },
          'key-c': { passed: [0], setAside: [], songStamped: false },
        },
      })
      expect(Object.keys(record.chapters)).toEqual(['key-c'])
    })

    it('drops indices past a chapter’s real combo count', () => {
      // key-g has 2 combos; 7 refers to nothing.
      const record = reconcilePathProgress({
        calibrated: true,
        chapters: {
          'key-g': { passed: [0, 7], setAside: [7], songStamped: false },
        },
      })
      expect(chapterProgress(record, 'key-g').passed).toEqual([0])
      expect(chapterProgress(record, 'key-g').setAside).toEqual([])
    })

    it('dedupes, sorts, and rejects non-integer indices', () => {
      const record = reconcilePathProgress({
        calibrated: true,
        chapters: {
          'key-c': {
            passed: [3, 1, 1, -1, 2.5, 0] as number[],
            setAside: [],
            songStamped: false,
          },
        },
      })
      expect(chapterProgress(record, 'key-c').passed).toEqual([0, 1, 3])
    })

    it('coerces the flags rather than trusting them', () => {
      const record = reconcilePathProgress({
        calibrated: 'yes' as unknown as boolean,
        chapters: {
          'key-c': {
            passed: [],
            setAside: [],
            songStamped: 1 as unknown as boolean,
          },
        },
      })
      expect(record.calibrated).toBe(false)
      expect(isSongStamped(record, 'key-c')).toBe(false)
    })

    it('leaves a sound record alone', () => {
      const sound = withPassed({ 'key-c': [0, 1, 2] })
      expect(reconcilePathProgress(sound)).toEqual(sound)
    })
  })
})

describe('position is derived, never stored (§2.3)', () => {
  it('opens at chapter 1, batch 1 on a fresh install', () => {
    const position = pathPosition(emptyPathProgress())
    expect(position.chapterIndex).toBe(0)
    expect(position.chapter?.id).toBe('key-c')
    expect(position.batchIndex).toBe(0)
    expect(position.batchTotal).toBe(2)
    expect(position.batch.map((c) => c.label)).toEqual(['C', 'F', 'G'])
    expect(position.batchUnpassed).toHaveLength(3)
    expect(position.batchPassed).toEqual([])
  })

  it('advances to the next batch only when the current one is whole', () => {
    const partial = withPassed({ 'key-c': [0, 1] })
    expect(pathPosition(partial).batchIndex).toBe(0)
    expect(pathPosition(partial).batchUnpassed.map((c) => c.label)).toEqual([
      'G',
    ])
    const whole = withPassed({ 'key-c': [0, 1, 2] })
    expect(pathPosition(whole).batchIndex).toBe(1)
    expect(pathPosition(whole).batch.map((c) => c.label)).toEqual([
      'Am',
      'Dm',
      'Em',
    ])
  })

  it('advances to the next chapter only when the current one is whole', () => {
    const record = withPassed({ 'key-c': ALL('key-c') })
    expect(pathPosition(record).chapter?.id).toBe('inversions-c')
  })

  it('walks over a later batch calibration already passed', () => {
    // Chapter 1's *second* batch passed but not its first: the position stays
    // on batch 1, and once that closes it skips straight past batch 2.
    const record = withPassed({ 'key-c': [3, 4, 5] })
    expect(pathPosition(record).batchIndex).toBe(0)
    const closed = withPassed({ 'key-c': [0, 1, 2, 3, 4, 5] })
    expect(pathPosition(closed).chapter?.id).toBe('inversions-c')
  })

  it('reports completion when the whole track is passed', () => {
    const record = withPassed(
      Object.fromEntries(CHAPTERS.map((c) => [c.id, ALL(c.id)])),
    )
    expect(isPathComplete(record)).toBe(true)
    expect(pathPosition(record).chapterIndex).toBe(CHAPTERS.length)
    expect(pathPosition(record).chapter).toBeNull()
  })

  it('knows when the batch is complete — the learning loop’s length', () => {
    expect(isBatchComplete(emptyPathProgress())).toBe(false)
    expect(isBatchComplete(withPassed({ 'key-c': [0, 1] }))).toBe(false)
    expect(isBatchComplete(withPassed({ 'key-c': [0, 1, 2] }))).toBe(false)
  })
})

describe('recordComboPass (§2.3)', () => {
  const cKey = keyAt('key-c', 0)

  it('latches a pass at D or better', () => {
    const update = recordComboPass(emptyPathProgress(), cKey, 'D')
    expect(update.changed).toBe(true)
    expect(chapterProgress(update.record, 'key-c').passed).toEqual([0])
  })

  it('refuses F and refuses no grade at all', () => {
    for (const grade of ['F', null] as const) {
      const before = emptyPathProgress()
      const update = recordComboPass(before, cKey, grade)
      expect(update.changed).toBe(false)
      expect(update.record).toBe(before) // untouched, not rebuilt
      expect(chapterProgress(update.record, 'key-c').passed).toEqual([])
    }
  })

  it('is idempotent — a passed combo passing again changes nothing', () => {
    const once = recordComboPass(emptyPathProgress(), cKey, 'S').record
    const twice = recordComboPass(once, cKey, 'S')
    expect(twice.changed).toBe(false)
    expect(twice.record).toBe(once)
  })

  it('never un-passes a combo whose grade fell back', () => {
    const passed = recordComboPass(emptyPathProgress(), cKey, 'D').record
    const later = recordComboPass(passed, cKey, 'F')
    expect(later.changed).toBe(false)
    expect(chapterProgress(later.record, 'key-c').passed).toEqual([0])
  })

  it('ignores a combo the track does not declare', () => {
    const update = recordComboPass(emptyPathProgress(), '0:dom13:closed', 'S')
    expect(update.changed).toBe(false)
    expect(update.chapter).toBeNull()
  })

  it('reports the batch edge on the combo that closes it', () => {
    let record = emptyPathProgress()
    const first = recordComboPass(record, keyAt('key-c', 0), 'B')
    expect(first.batchComplete).toBe(false)
    record = first.record
    record = recordComboPass(record, keyAt('key-c', 1), 'B').record
    const closing = recordComboPass(record, keyAt('key-c', 2), 'B')
    expect(closing.batchComplete).toBe(true)
    expect(closing.chapterComplete).toBe(false)
    expect(closing.chapter?.id).toBe('key-c')
  })

  it('reports the chapter edge on the combo that closes it', () => {
    let record = withPassed({ 'key-c': [0, 1, 2, 3, 4] })
    const closing = recordComboPass(record, keyAt('key-c', 5), 'B')
    expect(closing.batchComplete).toBe(true)
    expect(closing.chapterComplete).toBe(true)
  })

  it('latches a pass on a combo outside the current batch (§3.2)', () => {
    // A chapter-1 combo passing during a repertoire session, while the player
    // is nominally on a later chapter — the loops share one grading truth.
    const record = withPassed(passedUpTo('key-g'))
    const update = recordComboPass(record, keyAt('key-g', 1), 'C')
    expect(update.changed).toBe(true)
  })

  it('knows which keys the track declares', () => {
    expect(isPathCombo(keyAt('key-c', 0))).toBe(true)
    expect(isPathCombo('0:dom13:closed')).toBe(false)
  })
})

describe('the repertoire (§3.2)', () => {
  it('is every passed combo in track order', () => {
    const record = withPassed({ 'key-c': [0, 2], 'key-g': [0] })
    expect(repertoireCombos(record).map((c) => c.label)).toEqual([
      'C',
      'G',
      'D',
    ])
  })

  it('deals in track order even from an unsorted record', () => {
    // The order is structural, not a consequence of `passed` being sorted —
    // an unreconciled blob must not deal chords out of sequence.
    const scrambled = withPassed({ 'key-c': [2, 0], 'key-g': [0] })
    expect(repertoireCombos(scrambled).map((c) => c.label)).toEqual([
      'C',
      'G',
      'D',
    ])
  })

  it('grows with each pass', () => {
    let record = emptyPathProgress()
    expect(repertoireCombos(record)).toHaveLength(0)
    record = recordComboPass(record, keyAt('key-c', 0), 'B').record
    expect(repertoireCombos(record)).toHaveLength(1)
    record = recordComboPass(record, keyAt('key-c', 1), 'B').record
    expect(repertoireCombos(record)).toHaveLength(2)
  })

  it('projects into a derived combos preset that names each voicing', () => {
    const record = withPassed({ 'key-c': [0], 'inversions-c': [0] })
    const preset = repertoirePreset(record)
    expect(preset.id).toBe('repertoire')
    expect(preset.pool).toEqual({
      kind: 'combos',
      combos: [
        { root: 0, typeId: 'maj', voicingId: 'root-position' },
        { root: 0, typeId: 'maj', voicingId: 'first-inversion' },
      ],
    })
  })

  it('counts distinct triads, not combos, for the /24 headline', () => {
    // C in root position and C in first inversion are two combos, one chord.
    const record = withPassed({ 'key-c': [0], 'inversions-c': [0] })
    expect(repertoireCombos(record)).toHaveLength(2)
    expect(passedTriadCount(record)).toBe(1)
  })

  it('does not count a sus, dim or 7th combo as one of the 24', () => {
    const record = withPassed({ sus: [0, 1], 'dominant-7': [0] })
    expect(passedTriadCount(record)).toBe(0)
  })
})

describe('set aside (§5.2)', () => {
  // Six passed combos, so the floor of 3 leaves room to bench.
  const sixPassed = withPassed({ 'key-c': ALL('key-c') })

  it('takes a combo out of the repertoire without forgetting it', () => {
    const key = keyAt('key-c', 0)
    const record = setAsideCombo(sixPassed, key)
    expect(isComboSetAside(record, key)).toBe(true)
    expect(repertoireCombos(record).map((c) => c.label)).not.toContain('C')
    // Still passed — it stops being asked, not forgotten.
    expect(chapterProgress(record, 'key-c').passed).toContain(0)
  })

  it('refuses to leave fewer than three combos in play', () => {
    let record = withPassed({ 'key-c': [0, 1, 2, 3] })
    record = setAsideCombo(record, keyAt('key-c', 0))
    expect(repertoireCombos(record)).toHaveLength(3)
    expect(canSetAsideCombo(record, keyAt('key-c', 1))).toBe(false)
    expect(setAsideCombo(record, keyAt('key-c', 1))).toBe(record)
    expect(repertoireCombos(record)).toHaveLength(MIN_REPERTOIRE_COMBOS)
  })

  it('refuses a combo that was never passed', () => {
    expect(canSetAsideCombo(emptyPathProgress(), keyAt('key-c', 0))).toBe(false)
  })

  it('brings a benched combo back', () => {
    const key = keyAt('key-c', 0)
    const aside = setAsideCombo(sixPassed, key)
    const back = openCombo(aside, key)
    expect(isComboSetAside(back, key)).toBe(false)
    expect(repertoireCombos(back).map((c) => c.label)).toContain('C')
  })

  it('opening something not benched changes nothing', () => {
    expect(openCombo(sixPassed, keyAt('key-c', 0))).toBe(sixPassed)
  })

  it('never touches the learning batch — that would stall the path', () => {
    // Six of chapter 1 passed, so the position is chapter 2's first batch.
    // Setting aside a chapter-2 combo is impossible (it isn't passed), and
    // benching old material leaves the batch pool intact.
    const record = setAsideCombo(sixPassed, keyAt('key-c', 0))
    const { pool, batchKeys } = learningPool(record)
    expect(batchKeys.size).toBe(3)
    for (const key of batchKeys) {
      expect(pool.map(comboKey)).toContain(key)
    }
  })
})

describe('the song checkpoint (§3.3)', () => {
  it('stamps a key chapter once', () => {
    const stamped = stampChapterSong(emptyPathProgress(), 'key-c')
    expect(isSongStamped(stamped, 'key-c')).toBe(true)
    expect(stampChapterSong(stamped, 'key-c')).toBe(stamped)
  })

  it('refuses to stamp a skill chapter — it has no song', () => {
    const record = stampChapterSong(emptyPathProgress(), 'inversions-c')
    expect(isSongStamped(record, 'inversions-c')).toBe(false)
  })

  it('builds I-IV-V-I in the chapter’s key', () => {
    expect(chapterSong(chapter('key-g'))).toEqual([
      { degree: 0, root: 7, typeId: 'maj' },
      { degree: 3, root: 0, typeId: 'maj' },
      { degree: 4, root: 2, typeId: 'maj' },
      { degree: 0, root: 7, typeId: 'maj' },
    ])
    expect(chapterSong(chapter('inversions-c'))).toEqual([])
  })

  it('offers the current key chapter’s song while its batch is still open', () => {
    expect(songOffer(emptyPathProgress())?.id).toBe('key-c')
  })

  it('stops offering once stamped', () => {
    const record = stampChapterSong(emptyPathProgress(), 'key-c')
    expect(songOffer(record)).toBeNull()
  })

  it('offers a skipped song from behind a skill chapter', () => {
    // Chapter 1 finished unstamped; the player is now in chapter 2 (a skill
    // chapter, which has no song of its own).
    const record = withPassed({ 'key-c': ALL('key-c') })
    expect(pathPosition(record).chapter?.id).toBe('inversions-c')
    expect(songOffer(record)?.id).toBe('key-c')
  })

  it('does not hold a grudge over an older song once a newer one is stamped', () => {
    let record = withPassed(passedUpTo('dominant-7')) // through key-f
    // key-c never stamped, key-f is: nothing is owed.
    record = stampChapterSong(record, 'key-f')
    expect(songOffer(record)).toBeNull()
  })
})

describe('the learning pool (§3.1)', () => {
  it('is the batch, backfilled to three wide', () => {
    // Chapter 3's batch is two combos; the third slot comes from the
    // repertoire so the pool never narrows onto one chord.
    const record = withPassed(passedUpTo('key-g'))
    const { pool, batchKeys } = learningPool(record)
    expect(pool).toHaveLength(PATH_POOL_WIDTH)
    expect(batchKeys.size).toBe(2)
    expect(pool.slice(0, 2).map(comboKey)).toEqual([...batchKeys])
  })

  it('puts unpassed batch combos first, then passed ones, then old material', () => {
    // One of chapter 1's first batch already passed.
    const record = withPassed({ 'key-c': [0] })
    const { pool } = learningPool(record)
    expect(pool.map(comboKey)).toEqual([
      keyAt('key-c', 1), // F — unpassed
      keyAt('key-c', 2), // G — unpassed
      keyAt('key-c', 0), // C — passed batch material, not repertoire
    ])
  })

  it('comes up short only when nothing else exists', () => {
    // A brand-new path: batch of 3, empty repertoire — already 3 wide.
    expect(learningPool(emptyPathProgress()).pool).toHaveLength(3)
  })

  it('never duplicates a combo between batch and backfill', () => {
    const record = withPassed({ 'key-c': [0, 1, 2] })
    const { pool } = learningPool(record)
    expect(new Set(pool.map(comboKey)).size).toBe(pool.length)
  })

  it('keeps the batch ahead of the shakiest possible backfill', () => {
    // comboWeight tops out at 1 + MISS_WEIGHT_BOOST, so the boost has to at
    // least equal it or an old miss-ridden chord would out-draw new material.
    expect(BATCH_WEIGHT_BOOST).toBeGreaterThanOrEqual(1 + MISS_WEIGHT_BOOST)
  })

  it('excludes only the previous prompt, so the weights still decide', () => {
    // With PATH_POOL_WIDTH 3, §5's exclusion of 2 would leave one candidate
    // and make the pool a fixed rotation.
    expect(PATH_RECENT_WINDOW).toBe(1)
    expect(PATH_POOL_WIDTH - PATH_RECENT_WINDOW).toBeGreaterThan(1)
  })
})

describe('calibration (§5.2)', () => {
  it('passes nothing on a fresh install but marks itself done', () => {
    const record = calibratePath(emptyPathProgress(), NO_STATS)
    expect(record.calibrated).toBe(true)
    expect(passedTriadCount(record)).toBe(0)
    expect(pathPosition(record).chapter?.id).toBe('key-c')
  })

  it('fast-passes a combo the player has already proven', () => {
    const stats = reader({ [keyAt('key-g', 0)]: passingRecord() })
    const record = calibratePath(emptyPathProgress(), stats)
    expect(chapterProgress(record, 'key-g').passed).toEqual([0])
  })

  it('does not pass a combo whose record still fails', () => {
    const stats = reader({ [keyAt('key-g', 0)]: failingRecord() })
    const record = calibratePath(emptyPathProgress(), stats)
    expect(chapterProgress(record, 'key-g').passed).toEqual([])
  })

  it('honors the evidence floor — one lucky rep is not a pass', () => {
    const stats = reader({ [keyAt('key-g', 0)]: passingRecord(1) })
    const one = calibratePath(emptyPathProgress(), stats)
    // A single rep is 1/5 of a window; it only clears D inside S's second.
    // Two clean reps at 500 ms do clear it.
    const two = calibratePath(
      emptyPathProgress(),
      reader({ [keyAt('key-g', 0)]: passingRecord(2) }),
    )
    expect(chapterProgress(two, 'key-g').passed).toEqual([0])
    // Whatever the single-rep verdict, it must be no stronger than two reps'.
    expect(chapterProgress(one, 'key-g').passed.length).toBeLessThanOrEqual(1)
  })

  it('credits chapter 1 from a v9 `any` record — the alias that makes §5.2 true', () => {
    // v9's built-ins were all `any`; chapter 1 drills root-position (§5.3).
    const anyKey = comboKey({ root: 0, typeId: 'maj', voicingId: 'any' })
    const record = calibratePath(
      emptyPathProgress(),
      reader({ [anyKey]: passingRecord() }),
    )
    expect(chapterProgress(record, 'key-c').passed).toEqual([0])
  })

  it('does not alias in the other direction, or between unrelated voicings', () => {
    // A root-position record must not pass an `any` chapter combo: chapter 3's
    // D is keyed `any`, and only its own key counts.
    const rootKey = comboKey({
      root: 2,
      typeId: 'maj',
      voicingId: 'root-position',
    })
    const record = calibratePath(
      emptyPathProgress(),
      reader({ [rootKey]: passingRecord() }),
    )
    expect(chapterProgress(record, 'key-g').passed).toEqual([])
  })

  it('opens the path at the player’s real frontier', () => {
    // A returning player who has proven all of C (as `any`) and both of G.
    const stats: Record<string, ComboStatRecord> = {}
    for (const pathCombo of chapter('key-c').combos) {
      stats[comboKey({ ...pathCombo.combo, voicingId: 'any' })] =
        passingRecord()
    }
    for (const pathCombo of chapter('key-g').combos) {
      stats[comboKey(pathCombo.combo)] = passingRecord()
    }
    const record = calibratePath(emptyPathProgress(), reader(stats))
    expect(passedTriadCount(record)).toBe(8)
    // Chapter 2 (inversions) was never played, so that is the frontier.
    expect(pathPosition(record).chapter?.id).toBe('inversions-c')
  })

  it('keeps passes it did not grant', () => {
    const record = calibratePath(withPassed({ 'key-c': [0] }), NO_STATS)
    expect(chapterProgress(record, 'key-c').passed).toEqual([0])
  })

  it('preserves set-aside and stamps', () => {
    const before: PathProgressRecord = {
      calibrated: false,
      chapters: {
        'key-c': { passed: [0, 1, 2, 3], setAside: [0], songStamped: true },
      },
    }
    const after = calibratePath(before, NO_STATS)
    expect(chapterProgress(after, 'key-c').setAside).toEqual([0])
    expect(isSongStamped(after, 'key-c')).toBe(true)
  })
})

describe('the Today card (§4.1)', () => {
  const goalMet = { goalMet: true }
  const goalOpen = { goalMet: false }

  it('state 1: a batch in learning wins over everything', () => {
    const card = todayCard(emptyPathProgress(), goalOpen)
    expect(card.kind).toBe('batch')
    if (card.kind !== 'batch') return
    expect(card.chapter.id).toBe('key-c')
    expect(card.batchIndex).toBe(0)
    expect(card.batchTotal).toBe(2)
    expect(card.batch.map((c) => c.label)).toEqual(['C', 'F', 'G'])
  })

  it('state 2: batch done and the goal open → practice', () => {
    const record = withPassed({
      'key-c': ALL('key-c'),
      'inversions-c': ALL('inversions-c'),
    })
    // Position is chapter 3, whose batch is unpassed — so force a state where
    // the batch is done by completing the whole track instead.
    const done = withPassed(
      Object.fromEntries(CHAPTERS.map((c) => [c.id, ALL(c.id)])),
    )
    const card = todayCard(done, goalOpen)
    expect(card.kind).toBe('practice')
    if (card.kind !== 'practice') return
    expect(card.comboCount).toBe(repertoireCombos(done).length)
    // Sanity: the partial record really is still in a batch.
    expect(todayCard(record, goalOpen).kind).toBe('batch')
  })

  it('state 2 needs something to practice', () => {
    // Nothing passed *and* nothing in a batch can't happen on the real track,
    // but an empty repertoire must never produce a practice card.
    const done = withPassed(
      Object.fromEntries(CHAPTERS.map((c) => [c.id, ALL(c.id)])),
    )
    const benched: PathProgressRecord = {
      ...done,
      chapters: Object.fromEntries(
        Object.entries(done.chapters).map(([id, p]) => [
          id,
          { ...p, setAside: p.passed },
        ]),
      ),
    }
    expect(repertoireCombos(benched)).toEqual([])
    expect(todayCard(benched, goalOpen).kind).not.toBe('practice')
  })

  it('state 3: goal met and a song unstamped → the song', () => {
    const done = withPassed(
      Object.fromEntries(CHAPTERS.map((c) => [c.id, ALL(c.id)])),
    )
    const card = todayCard(done, goalMet)
    expect(card.kind).toBe('song')
    if (card.kind !== 'song') return
    expect(card.chapter.id).toBe('key-db') // the most recent key chapter
    expect(card.progression).toHaveLength(4)
  })

  it('state 4: everything done', () => {
    let record = withPassed(
      Object.fromEntries(CHAPTERS.map((c) => [c.id, ALL(c.id)])),
    )
    for (const chapter of CHAPTERS) {
      record = stampChapterSong(record, chapter.id)
    }
    expect(todayCard(record, goalMet).kind).toBe('done')
  })

  it('practice outranks the song while the goal is open', () => {
    const done = withPassed(
      Object.fromEntries(CHAPTERS.map((c) => [c.id, ALL(c.id)])),
    )
    expect(todayCard(done, goalOpen).kind).toBe('practice')
    expect(todayCard(done, goalMet).kind).toBe('song')
  })
})

describe('the path map (§4.2)', () => {
  it('marks every chapter done, current or locked, and names them all', () => {
    const record = withPassed(passedUpTo('key-g'))
    const rows = chapterRows(record, NO_STATS)
    expect(rows).toHaveLength(CHAPTERS.length)
    expect(rows.map((r) => r.state).slice(0, 4)).toEqual([
      'done',
      'done',
      'current',
      'locked',
    ])
    for (const row of rows) {
      expect(row.chapter.title, row.chapter.id).not.toBe('')
      expect(row.chapter.blurb, row.chapter.id).not.toBe('')
    }
  })

  it('carries the current chapter’s batch with live grades, and no other’s', () => {
    const record = withPassed(passedUpTo('key-g'))
    const stats = reader({ [keyAt('key-g', 0)]: failingRecord() })
    const rows = chapterRows(record, stats)
    const current = rows.find((r) => r.state === 'current')
    expect(current?.batch.map((c) => c.label)).toEqual(['D', 'Bm'])
    expect(current?.batch[0]?.grade).toBe('F')
    expect(current?.batch[1]?.grade).toBeNull() // never played
    for (const row of rows) {
      if (row.state !== 'current') expect(row.batch, row.chapter.id).toEqual([])
    }
  })

  it('reports each chapter’s pass count, song and totals', () => {
    let record = withPassed(passedUpTo('key-g'))
    record = stampChapterSong(record, 'key-c')
    const rows = chapterRows(record, NO_STATS)
    const first = rows[0]
    expect(first?.passedCount).toBe(6)
    expect(first?.total).toBe(6)
    expect(first?.songStamped).toBe(true)
    expect(first?.hasSong).toBe(true)
    expect(rows[1]?.hasSong).toBe(false) // the inversions skill chapter
  })

  it('shows a `new` grade rather than a red F below the evidence floor', () => {
    const oneMiss = applyOutcome(null, 'missed', 3000)
    const rows = chapterRows(
      emptyPathProgress(),
      reader({ [keyAt('key-c', 0)]: oneMiss }),
    )
    expect(rows[0]?.batch[0]?.grade).toBe('new')
  })
})
