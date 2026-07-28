// Progress along the guided path (DESIGN.md §2.3, §3, §5): what the player has
// passed, where that puts them, and the pools the two loops deal from. Pure TS
// — the persisted record lives in storage/ and the store applies the policy.
//
// The whole position is *derived*: current chapter and current batch are the
// first not-yet-passed spot, never stored (§5.1). That linearity is the gate —
// "a chapter opens when the previous one is passed" needs no separate check,
// and there is no state that can disagree with the pass flags.

import {
  batchOfIndex,
  CHAPTERS,
  chapterById,
  isPathTriad,
  PATH_COMBO_INDEX,
  PATH_TRIAD_TOTAL,
  triadKey,
  type ChapterDefinition,
  type PathCombo,
} from './chapters'
import { comboKey, type Combo } from './combos'
import { MISS_WEIGHT_BOOST } from './generator'
import type { Preset } from './presets'
import { buildDegreeProgression, type SongChord } from './song'
import {
  comboMetrics,
  displayGrade,
  isPassingGrade,
  type ComboGrade,
  type ComboStatRecord,
  type DisplayGrade,
} from './stats'

// ─── The record (§5.1) ─────────────────────────────────────────────────────

export interface ChapterProgressRecord {
  // Indices into the chapter's declared combo list, sorted ascending — the
  // same indices-not-identities choice the retired per-preset record made, so
  // a chapter's progress survives a relabelling of what it contains.
  passed: number[]
  // Combos set aside by hand (§5.2). Applied to the repertoire pool only:
  // benching batch material would either stall the path or auto-advance a
  // chapter that was never learned, so the learning loop ignores this.
  setAside: number[]
  // The 🎵 song checkpoint (§3.3). Progress, never a gate.
  songStamped: boolean
}

export interface PathProgressRecord {
  // The §5.2 calibration latch. False on a fresh install *and* on every v9
  // upgrade, so the first load fast-passes what the player has already proven.
  // Once true it stays true: a later improvement must not silently skip a
  // chapter the player never walked.
  calibrated: boolean
  chapters: Record<string, ChapterProgressRecord>
}

export function emptyChapterProgress(): ChapterProgressRecord {
  return { passed: [], setAside: [], songStamped: false }
}

export function emptyPathProgress(): PathProgressRecord {
  return { calibrated: false, chapters: {} }
}

export function chapterProgress(
  record: PathProgressRecord,
  chapterId: string,
): ChapterProgressRecord {
  return record.chapters[chapterId] ?? emptyChapterProgress()
}

// Clamps a stored record to the track as it exists now (§5.1: clamp, never
// crash). Chapter ids the track no longer declares are dropped; indices past a
// chapter's real combo count are dropped. A track edit is therefore always
// survivable, at the cost of the progress that no longer refers to anything.
export function reconcilePathProgress(
  record: PathProgressRecord,
): PathProgressRecord {
  const chapters: Record<string, ChapterProgressRecord> = {}
  for (const [id, stored] of Object.entries(record.chapters)) {
    const chapter = chapterById(id)
    if (chapter === undefined) continue
    const clamp = (indices: readonly number[]): number[] =>
      [...new Set(indices)]
        .filter(
          (i) => Number.isInteger(i) && i >= 0 && i < chapter.combos.length,
        )
        .sort((a, b) => a - b)
    chapters[id] = {
      passed: clamp(stored.passed),
      setAside: clamp(stored.setAside),
      songStamped: stored.songStamped === true,
    }
  }
  return { calibrated: record.calibrated === true, chapters }
}

// ─── Position (§2.3) ───────────────────────────────────────────────────────

export interface PathPosition {
  // CHAPTERS.length once every combo on the track is passed.
  chapterIndex: number
  chapter: ChapterDefinition | null
  batchIndex: number
  batchTotal: number
  batch: readonly PathCombo[]
  batchUnpassed: readonly PathCombo[]
  batchPassed: readonly PathCombo[]
}

const COMPLETE: PathPosition = {
  chapterIndex: CHAPTERS.length,
  chapter: null,
  batchIndex: 0,
  batchTotal: 0,
  batch: [],
  batchUnpassed: [],
  batchPassed: [],
}

export function pathPosition(record: PathProgressRecord): PathPosition {
  for (const [chapterIndex, chapter] of CHAPTERS.entries()) {
    const passed = new Set(chapterProgress(record, chapter.id).passed)
    if (chapter.combos.every((_, i) => passed.has(i))) continue
    // The first batch of this chapter with anything outstanding. A later batch
    // that calibration happened to pass whole is simply walked over once the
    // gap ahead of it closes.
    let at = 0
    for (const [batchIndex, batch] of chapter.batches.entries()) {
      const indices = batch.map((_, i) => at + i)
      at += batch.length
      if (indices.every((i) => passed.has(i))) continue
      return {
        chapterIndex,
        chapter,
        batchIndex,
        batchTotal: chapter.batches.length,
        batch,
        batchUnpassed: batch.filter((_, i) => !passed.has(indices[i] ?? -1)),
        batchPassed: batch.filter((_, i) => passed.has(indices[i] ?? -1)),
      }
    }
  }
  return COMPLETE
}

// Is every combo of the position's batch passed? The learning loop's end
// condition (§3.1): the batch *is* the session's length.
export function isBatchComplete(record: PathProgressRecord): boolean {
  return pathPosition(record).batchUnpassed.length === 0
}

export function isPathComplete(record: PathProgressRecord): boolean {
  return pathPosition(record).chapter === null
}

// ─── Passing (§2.3) ────────────────────────────────────────────────────────

export interface PassUpdate {
  record: PathProgressRecord
  changed: boolean
  // The combo that passed completed its batch / its whole chapter. Both read
  // *after* the pass, which is what the Report and the end condition need.
  batchComplete: boolean
  chapterComplete: boolean
  chapter: ChapterDefinition | null
}

const NO_PASS = (record: PathProgressRecord): PassUpdate => ({
  record,
  changed: false,
  batchComplete: false,
  chapterComplete: false,
  chapter: null,
})

// Feeds one counted rep into the record, as the combo's grade *after* that rep
// was recorded — the v9 pass bar unchanged (§5.1): D or better, with the
// evidence floor already inside the grade, so about two clean reps at an
// ordinary pace. Per *combo* rather than per chord, because the path's
// material varies by voicing and the fold v9 needed has nothing left to fold.
//
// Deliberately blind to whether the combo is in the current batch: a pass
// earned in daily or free practice counts (§3.2), and the loops share one
// grading truth. The batch is a derivation, not a gate on recording.
//
// Passing is a latch — a combo whose grade later falls back to F stays passed
// and its chapter stays open. The path is a ratchet; the live grade is
// reported everywhere else anyway.
export function recordComboPass(
  record: PathProgressRecord,
  key: string,
  grade: ComboGrade | null,
): PassUpdate {
  if (!isPassingGrade(grade)) return NO_PASS(record)
  // A combo the track doesn't declare — free practice reaches those, and they
  // simply have nothing to latch.
  const located = locate(key)
  if (located === null) return NO_PASS(record)
  const { chapter, index } = located
  const before = chapterProgress(record, chapter.id)
  if (before.passed.includes(index)) return NO_PASS(record)

  const passed = [...before.passed, index].sort((a, b) => a - b)
  const next: PathProgressRecord = {
    ...record,
    chapters: { ...record.chapters, [chapter.id]: { ...before, passed } },
  }
  const passedSet = new Set(passed)
  const batchIndex = batchOfIndex(chapter, index)
  let at = 0
  for (let b = 0; b < batchIndex; b++) at += chapter.batches[b]?.length ?? 0
  const batch = chapter.batches[batchIndex] ?? []
  return {
    record: next,
    changed: true,
    batchComplete: batch.every((_, i) => passedSet.has(at + i)),
    chapterComplete: chapter.combos.every((_, i) => passedSet.has(i)),
    chapter,
  }
}

// Which chapter and index a combo key belongs to. Linear over 66 combos and
// called once per recorded rep — a lookup map would need rebuilding whenever
// the track changes and buys nothing at this size.
function locate(
  key: string,
): { chapter: ChapterDefinition; index: number } | null {
  for (const chapter of CHAPTERS) {
    const index = chapter.combos.findIndex((pc) => comboKey(pc.combo) === key)
    if (index >= 0) return { chapter, index }
  }
  return null
}

export function isPathCombo(key: string): boolean {
  return PATH_COMBO_INDEX.has(key)
}

// ─── The repertoire (§3.2) ─────────────────────────────────────────────────

// Walks the track in declared order, keeping the combos a predicate accepts.
// Order comes from CHAPTERS rather than from the record's index arrays: those
// are documented as sorted and always written sorted, but a pool whose order
// depended on that would deal chords out of sequence if a hand-edited blob ever
// reached here unreconciled.
function collect(
  record: PathProgressRecord,
  keep: (progress: ChapterProgressRecord, index: number) => boolean,
): readonly PathCombo[] {
  const out: PathCombo[] = []
  for (const chapter of CHAPTERS) {
    const progress = chapterProgress(record, chapter.id)
    chapter.combos.forEach((pathCombo, index) => {
      if (keep(progress, index)) out.push(pathCombo)
    })
  }
  return out
}

// Every passed combo on the path, in track order, minus the ones set aside.
export function repertoireCombos(
  record: PathProgressRecord,
): readonly PathCombo[] {
  return collect(
    record,
    (progress, index) =>
      progress.passed.includes(index) && !progress.setAside.includes(index),
  )
}

// Passed *including* the set-aside ones — what the repertoire row displays, so
// a benched combo stays visible with its grade rather than vanishing (§5.2).
export function passedCombos(record: PathProgressRecord): readonly PathCombo[] {
  return collect(record, (progress, index) => progress.passed.includes(index))
}

export function setAsideCombos(
  record: PathProgressRecord,
): readonly PathCombo[] {
  return collect(
    record,
    (progress, index) =>
      progress.setAside.includes(index) && progress.passed.includes(index),
  )
}

// The path's headline number (§4.1): distinct major/minor triads passed, out
// of PATH_TRIAD_TOTAL. Deduped by (root, quality), so C in two inversions is
// still one chord here — the repertoire row's chip count is the larger figure
// and is deliberately labelled differently.
export function passedTriadCount(record: PathProgressRecord): number {
  const triads = new Set<string>()
  for (const { combo } of passedCombos(record)) {
    if (isPathTriad(combo)) triads.add(triadKey(combo))
  }
  return triads.size
}

export { PATH_TRIAD_TOTAL }

// ─── Set aside (§5.2) ──────────────────────────────────────────────────────

// How few combos setting one aside may leave in the repertoire. The same floor
// the retired per-preset version used, for the same reason: a drill needs
// something to alternate between. Global across the whole repertoire, not per
// chapter — a chapter of two would otherwise never allow it at all.
export const MIN_REPERTOIRE_COMBOS = 3

export function isComboSetAside(
  record: PathProgressRecord,
  key: string,
): boolean {
  const located = locate(key)
  if (located === null) return false
  return chapterProgress(record, located.chapter.id).setAside.includes(
    located.index,
  )
}

export function canSetAsideCombo(
  record: PathProgressRecord,
  key: string,
): boolean {
  const located = locate(key)
  if (located === null) return false
  const progress = chapterProgress(record, located.chapter.id)
  if (!progress.passed.includes(located.index)) return false // not in play yet
  if (progress.setAside.includes(located.index)) return false
  return repertoireCombos(record).length - 1 >= MIN_REPERTOIRE_COMBOS
}

export function setAsideCombo(
  record: PathProgressRecord,
  key: string,
): PathProgressRecord {
  if (!canSetAsideCombo(record, key)) return record
  const located = locate(key)
  if (located === null) return record
  const progress = chapterProgress(record, located.chapter.id)
  return {
    ...record,
    chapters: {
      ...record.chapters,
      [located.chapter.id]: {
        ...progress,
        setAside: [...progress.setAside, located.index].sort((a, b) => a - b),
      },
    },
  }
}

// Brings a benched combo back — the one inverse action (§5.2). There is no
// early-unlock counterpart in v10: calibration is the only fast lane (§4.2).
export function openCombo(
  record: PathProgressRecord,
  key: string,
): PathProgressRecord {
  const located = locate(key)
  if (located === null) return record
  const progress = chapterProgress(record, located.chapter.id)
  if (!progress.setAside.includes(located.index)) return record
  return {
    ...record,
    chapters: {
      ...record.chapters,
      [located.chapter.id]: {
        ...progress,
        setAside: progress.setAside.filter((i) => i !== located.index),
      },
    },
  }
}

// ─── The song checkpoint (§3.3) ────────────────────────────────────────────

export function isSongStamped(
  record: PathProgressRecord,
  chapterId: string,
): boolean {
  return chapterProgress(record, chapterId).songStamped
}

export function stampChapterSong(
  record: PathProgressRecord,
  chapterId: string,
): PathProgressRecord {
  const chapter = chapterById(chapterId)
  if (chapter === undefined || chapter.songDegrees === null) return record
  const progress = chapterProgress(record, chapterId)
  if (progress.songStamped) return record
  return {
    ...record,
    chapters: {
      ...record.chapters,
      [chapterId]: { ...progress, songStamped: true },
    },
  }
}

// The chapter whose song Home should offer, or null when nothing is owed
// (§4.1 state 3). The current chapter if it is an unstamped key chapter, else
// the latest key chapter already finished and still unstamped — so a skill
// chapter in progress doesn't hide the song the player skipped, and the offer
// stops the moment it is stamped.
export function songOffer(
  record: PathProgressRecord,
): ChapterDefinition | null {
  const position = pathPosition(record)
  const current = position.chapter
  if (
    current !== null &&
    current.songDegrees !== null &&
    !isSongStamped(record, current.id)
  ) {
    return current
  }
  // Otherwise the most recently *finished* key chapter, and only that one: if
  // its song is stamped the player has been keeping up, and nothing older is
  // owed. An app that nagged about a song from ten chapters ago would be
  // holding a grudge, not offering a reward.
  const finished = CHAPTERS.slice(0, position.chapterIndex)
  const latestKey = finished.filter((c) => c.songDegrees !== null).pop()
  if (latestKey === undefined) return null
  return isSongStamped(record, latestKey.id) ? null : latestKey
}

export function chapterSong(chapter: ChapterDefinition): SongChord[] {
  if (chapter.key === null || chapter.songDegrees === null) return []
  return buildDegreeProgression(chapter.key, chapter.songDegrees)
}

// ─── The learning pool (§3.1) ──────────────────────────────────────────────

// How wide the learning loop deals. The batch's unpassed combos first, then
// its passed ones, then the wider repertoire — because a pool that narrowed to
// the single last unpassed combo would deal it on repeat, which is both the
// weakest way to fix a shaky chord and the fastest way to make a session feel
// stuck.
export const PATH_POOL_WIDTH = 3

// One wide, not three. §5's exclusion of `min(3, poolSize − 1)` would leave
// exactly one candidate in a 3-wide pool — a fixed rotation, where the weights
// never apply and the next prompt is always predictable, which is the wrong
// property for a recall drill. "Never the same combo twice in a row" is the
// rule that actually matters here, and it leaves the weighting something to do.
export const PATH_RECENT_WINDOW = 1

// How much a batch combo outweighs backfill. comboWeight tops out at
// 1 + MISS_WEIGHT_BOOST, so this is the smallest multiplier a maximally shaky
// old chord cannot beat: with two unpassed combos in the pool the batch takes
// three prompts in four, and with one left it alternates — the ceiling short of
// allowing an immediate repeat.
export const BATCH_WEIGHT_BOOST = 1 + MISS_WEIGHT_BOOST

export interface LearningPool {
  pool: readonly Combo[]
  // The batch's combos, for the intro-rep tag and the weight boost. Backfill
  // is not in here: it is passed material by definition, so it never gets a
  // first look and never counts toward the end condition.
  batchKeys: ReadonlySet<string>
}

export function learningPool(record: PathProgressRecord): LearningPool {
  const position = pathPosition(record)
  const batchKeys = new Set(
    position.batch.map((pathCombo) => comboKey(pathCombo.combo)),
  )
  const seen = new Set<string>()
  const pool: Combo[] = []
  const add = (pathCombo: PathCombo) => {
    const key = comboKey(pathCombo.combo)
    if (seen.has(key)) return
    seen.add(key)
    pool.push(pathCombo.combo)
  }
  position.batchUnpassed.forEach(add)
  position.batchPassed.forEach(add)
  for (const pathCombo of repertoireCombos(record)) {
    if (pool.length >= PATH_POOL_WIDTH) break
    add(pathCombo)
  }
  return { pool, batchKeys }
}

// ─── The Repertoire preset (§3.2) ──────────────────────────────────────────

export const REPERTOIRE_PRESET_ID = 'repertoire'
export const REPERTOIRE_PRESET_NAME = 'Repertoire'

// Daily practice is not a session type — it is the v9 Practice session run on
// this one derived preset. Derived, never persisted: it is a projection of the
// record through the chapter definitions, so it can't drift from what the path
// says is learned, and it grows itself on every pass.
export function repertoirePreset(record: PathProgressRecord): Preset {
  return {
    id: REPERTOIRE_PRESET_ID,
    name: REPERTOIRE_PRESET_NAME,
    pool: {
      kind: 'combos',
      combos: repertoireCombos(record).map((pathCombo) => pathCombo.combo),
    },
    // Ignored for a `combos` pool — the pool names each combo's voicing.
    voicingIds: ['any'],
  }
}

// ─── Calibration (§5.2) ────────────────────────────────────────────────────

// The one place a combo's evidence is read through a key other than its own.
// Chapter 1 drills root position (§5.3) but every v9 built-in preset except
// the inversion drills used `any`, so a returning player's whole history would
// score zero against it and the path would open at chapter 1 batch 1 — exactly
// what calibration exists to prevent. root-position ⊂ any, so an `any` record
// is the weaker evidence; accepted, because this is one-shot, on six combos,
// against reps earned before v10 existed.
const CALIBRATION_ALIASES: Readonly<Record<string, readonly string[]>> = {
  'root-position': ['any'],
}

export interface ComboRecordReader {
  get(key: string): ComboStatRecord | null
}

// Marks every chapter combo the player has *already* proven as passed, on
// first entry to the path — a fresh v10 install and a v9 upgrade are the same
// code path (§5.2). The bar is the pass bar itself, not a special drill: one
// grading truth, and no new mechanism. A fresh install passes nothing.
export function calibratePath(
  record: PathProgressRecord,
  stats: ComboRecordReader,
): PathProgressRecord {
  const chapters: Record<string, ChapterProgressRecord> = {}
  for (const chapter of CHAPTERS) {
    const progress = chapterProgress(record, chapter.id)
    const passed = new Set(progress.passed)
    chapter.combos.forEach((pathCombo, index) => {
      if (passed.has(index)) return
      if (calibrationPasses(pathCombo, stats)) passed.add(index)
    })
    chapters[chapter.id] = {
      ...progress,
      passed: [...passed].sort((a, b) => a - b),
    }
  }
  return { calibrated: true, chapters }
}

function calibrationPasses(
  pathCombo: PathCombo,
  stats: ComboRecordReader,
): boolean {
  const keys = [
    comboKey(pathCombo.combo),
    ...(CALIBRATION_ALIASES[pathCombo.combo.voicingId] ?? []).map((voicingId) =>
      comboKey({ ...pathCombo.combo, voicingId }),
    ),
  ]
  return keys.some((key) => {
    const record = stats.get(key)
    return record !== null && isPassingGrade(comboMetrics(record).grade)
  })
}

// ─── Display (§4.1, §4.2) ──────────────────────────────────────────────────

// A combo as the Today card, repertoire row and path map show it: its label,
// its live grade, and the two states the row distinguishes.
export interface PathComboView {
  key: string
  label: string
  grade: DisplayGrade | null // null: never played, so not even `new` applies
  passed: boolean
  setAside: boolean
}

export function comboView(
  record: PathProgressRecord,
  pathCombo: PathCombo,
  passed: boolean,
  stats: ComboRecordReader,
): PathComboView {
  const key = comboKey(pathCombo.combo)
  const stat = stats.get(key)
  return {
    key,
    label: pathCombo.label,
    grade: stat === null ? null : displayGrade(stat),
    passed,
    setAside: isComboSetAside(record, key),
  }
}

export type ChapterRowState = 'done' | 'current' | 'locked'

// One row of the path map (§4.2). Locked chapters are named — "what's coming"
// stays answerable — but nothing here is startable: there is no manual early
// unlock in v10.
export interface ChapterRow {
  chapter: ChapterDefinition
  state: ChapterRowState
  passedCount: number
  total: number
  songStamped: boolean
  hasSong: boolean
  // Populated for the current chapter only: its batch, with live grades.
  batch: readonly PathComboView[]
  batchIndex: number
  batchTotal: number
}

export function chapterRows(
  record: PathProgressRecord,
  stats: ComboRecordReader,
): ChapterRow[] {
  const position = pathPosition(record)
  return CHAPTERS.map((chapter, index) => {
    const progress = chapterProgress(record, chapter.id)
    const passed = new Set(progress.passed)
    const isCurrent = index === position.chapterIndex
    const state: ChapterRowState =
      index < position.chapterIndex ? 'done' : isCurrent ? 'current' : 'locked'
    let at = 0
    for (let b = 0; b < position.batchIndex; b++) {
      at += chapter.batches[b]?.length ?? 0
    }
    return {
      chapter,
      state,
      passedCount: passed.size,
      total: chapter.combos.length,
      songStamped: progress.songStamped,
      hasSong: chapter.songDegrees !== null,
      batch: isCurrent
        ? position.batch.map((pathCombo, i) =>
            comboView(record, pathCombo, passed.has(at + i), stats),
          )
        : [],
      batchIndex: isCurrent ? position.batchIndex : 0,
      batchTotal: chapter.batches.length,
    }
  })
}

// ─── The Today card (§4.1) ─────────────────────────────────────────────────

// Home's one primary action, first match wins. A pure function of the record
// plus the single fact it can't derive — whether today's goal is met — so the
// whole state machine is testable without a store. The card's *secondary*
// actions are derived in the component from pathPosition and songOffer: one
// button is not a lock (§4.1).
export type TodayCard =
  | {
      kind: 'batch'
      chapter: ChapterDefinition
      batchIndex: number
      batchTotal: number
      batch: readonly PathCombo[]
    }
  | { kind: 'practice'; comboCount: number }
  | { kind: 'song'; chapter: ChapterDefinition; progression: SongChord[] }
  | { kind: 'done' }

export function todayCard(
  record: PathProgressRecord,
  context: { goalMet: boolean },
): TodayCard {
  const position = pathPosition(record)
  if (position.chapter !== null && position.batchUnpassed.length > 0) {
    return {
      kind: 'batch',
      chapter: position.chapter,
      batchIndex: position.batchIndex,
      batchTotal: position.batchTotal,
      batch: position.batch,
    }
  }
  const repertoire = repertoireCombos(record)
  if (!context.goalMet && repertoire.length > 0) {
    return { kind: 'practice', comboCount: repertoire.length }
  }
  const song = songOffer(record)
  if (song !== null) {
    return { kind: 'song', chapter: song, progression: chapterSong(song) }
  }
  return { kind: 'done' }
}
