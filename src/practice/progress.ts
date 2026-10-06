// Flashcard-style unlock progress (DESIGN.md §5): a preset starts with only
// its first few chords in play, and each pass — a grade risen to D or better
// (§5.1) — opens the next, so a fixed number of not-yet-passed chords is
// always being learned. The player can also open and
// close chords by hand (§5.2): setting one aside holds it out of play and out
// of the unlock gate. Pure TS; the persisted record lives in storage/ and the
// store applies the gating.

import { isPassingGrade, type ComboGrade } from './stats'
import { isScaleCombo, type Combo } from './combos'
import { getScaleType, type ChordTypeId, type PitchClass } from '../theory'

// A fresh preset opens with this many chords unlocked (clamped to the pool).
export const INITIAL_UNLOCK_COUNT = 3

// How few chords setting one aside (§5.2) may leave in play. A drill needs
// something to alternate between, and the same number a fresh preset opens
// with is the smallest pool the app ever deals from — so a preset can't be
// whittled below its own starting width. A pool at or under this size simply
// has nothing to set aside.
export const MIN_ACTIVE_CHORDS = 3

// Progress is tracked per chord (root + type, across all its voicing
// combos), keyed like comboKey minus the voicing — and per scale (root +
// scale type, across its shapes), keyed like a scale comboKey minus the
// shape. Both are "chords" to the unlock queue (§5).
export function poolChordKey(
  chord: { root: PitchClass; typeId: ChordTypeId } | Combo,
): string {
  if ('scaleTypeId' in chord) {
    return `s:${chord.root}:${chord.scaleTypeId}`
  }
  return `${chord.root}:${chord.typeId}`
}

// How the unlock queue is ordered (§5.1): 'pool' follows the pool's own
// order; 'fifths' reorders roots along the circle of fifths (C → G → D …),
// for root-ordered pools where chromatic neighbors aren't the musical ones;
// 'keys' orders scale roots by their key's accidental count, which is how
// scale presets always unlock.
export type UnlockOrderMode = 'pool' | 'fifths' | 'keys'

// Circle-of-fifths position of a pitch class: C=0, G=1, D=2 … F=11.
function fifthsIndex(pc: number): number {
  return (pc * 7) % 12
}

// Scale roots by accidental count, alternating sharp and flat keys (§5.1):
// each new key adds at most one accidental over what is already open. The
// true circle would hold F major (one flat) back behind six-sharp F♯, and
// chromatic order would make the second scale C♯/D♭.
const MAJOR_KEY_ORDER: readonly PitchClass[] = [
  0, 7, 5, 2, 10, 9, 3, 4, 8, 11, 1, 6,
] // C G F D B♭ A E♭ E A♭ B D♭ F♯
const MINOR_KEY_ORDER: readonly PitchClass[] = [
  9, 4, 2, 11, 7, 6, 0, 1, 5, 8, 10, 3,
] // A E D B G F♯ C C♯ F G♯ B♭ E♭

function keysIndex(combo: Combo): number {
  if (!isScaleCombo(combo)) return fifthsIndex(combo.root)
  const order =
    getScaleType(combo.scaleTypeId).tonality === 'major'
      ? MAJOR_KEY_ORDER
      : MINOR_KEY_ORDER
  return order.indexOf(combo.root)
}

// The unlock order: the pool's own order (§4/§5), reconstructed from the
// expansion rather than poolChords() so chords with no satisfiable combo —
// which can never be attempted, hence never passed — don't occupy (and
// permanently block) an unlock slot. Combos of one chord are contiguous in
// an expansion, so first-occurrence dedup preserves pool order exactly.
// 'fifths' and 'keys' modes then stable-sort by root, keeping one root's
// chords (or scale types) in their pool order relative to each other.
export function chordOrderOf(
  combos: readonly Combo[],
  mode: UnlockOrderMode = 'pool',
): string[] {
  const seen = new Set<string>()
  const chords: { key: string; rank: number }[] = []
  for (const combo of combos) {
    const key = poolChordKey(combo)
    if (!seen.has(key)) {
      seen.add(key)
      const rank =
        mode === 'fifths'
          ? fifthsIndex(combo.root)
          : mode === 'keys'
            ? keysIndex(combo)
            : 0
      chords.push({ key, rank })
    }
  }
  chords.sort((a, b) => a.rank - b.rank)
  return chords.map((chord) => chord.key)
}

// Persisted per preset id (§8). Passed chords are stored as *indices* into
// the chord order, not chord identity, so the diatonic preset's progress
// means "scale degree N" and survives a key change (§5). The field is still
// named masteredIndices in the persisted JSON — renaming it would need a
// schema migration for existing users, disproportionate for a wording-only
// change (the concept itself is just "passed", see recordChordAttempt).
export interface PresetProgressRecord {
  unlockedCount: number
  masteredIndices: number[] // sorted ascending, each < unlockedCount
  // Chords set aside by hand (§5.2): unlocked but held out of play, sorted
  // ascending, each < unlockedCount. Absent in early-v2 states, where it
  // defaults to empty rather than invalidating the record (§8).
  setAsideIndices: number[]
}

export function initialProgress(totalChords: number): PresetProgressRecord {
  return {
    unlockedCount: Math.min(INITIAL_UNLOCK_COUNT, Math.max(totalChords, 1)),
    masteredIndices: [],
    setAsideIndices: [],
  }
}

// Clamps a stored record to a pool's actual size — a custom preset's pool
// can shrink under its saved progress (library edit), and the sanitizer
// can't know pool sizes. Never below the initial count so a record can't
// pin a preset to fewer chords than a fresh start would give.
export function reconcileProgress(
  record: PresetProgressRecord,
  totalChords: number,
  learning: number,
): PresetProgressRecord {
  const floor = initialProgress(totalChords).unlockedCount
  const unlockedCount = Math.min(
    Math.max(Math.floor(record.unlockedCount), floor),
    Math.max(totalChords, 1),
  )
  const masteredIndices = [...new Set(record.masteredIndices)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < unlockedCount)
    .sort((a, b) => a - b)
  // A shrinking pool can pull the unlock frontier back under the set-aside
  // list until too little is left in play (§5.2); the newest ones come back
  // first, since they were set aside against a pool that no longer exists.
  const setAsideIndices = [...new Set(record.setAsideIndices)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < unlockedCount)
    .sort((a, b) => a - b)
  const minActive = Math.min(MIN_ACTIVE_CHORDS, unlockedCount)
  while (unlockedCount - setAsideIndices.length < minActive) {
    setAsideIndices.pop()
  }
  // A pool that grew under the record, or a learning window raised since it
  // was saved, has room for more, and no pass is left to open it.
  return settleUnlock(
    { unlockedCount, masteredIndices, setAsideIndices },
    totalChords,
    learning,
  )
}

// Carries a record across a custom-preset edit that reshaped its pool (§5.1):
// passed and set-aside marks follow their items to wherever they now sit, and
// every item that was unlocked stays unlocked. The frontier is a prefix, so it
// reaches the furthest of them — an item the edit put in front of it opens
// with them, not passed. Items the edit removed take their marks with them.
// Positional carry-over is for pools whose positions *are* the identity — the
// diatonic key and the unlock-order setting — and the caller keeps those.
export function remapProgress(
  oldOrder: readonly string[],
  newOrder: readonly string[],
  record: PresetProgressRecord,
  learning: number,
): PresetProgressRecord {
  const position = new Map(newOrder.map((key, index) => [key, index]))
  const moved = (indices: Iterable<number>): number[] => {
    const next: number[] = []
    for (const index of indices) {
      const key = oldOrder[index]
      const to = key === undefined ? undefined : position.get(key)
      if (to !== undefined) next.push(to)
    }
    return next
  }
  const unlocked = moved(
    Array.from({ length: record.unlockedCount }, (_, index) => index),
  )
  return reconcileProgress(
    {
      unlockedCount: unlocked.length > 0 ? Math.max(...unlocked) + 1 : 0,
      masteredIndices: moved(record.masteredIndices),
      setAsideIndices: moved(record.setAsideIndices),
    },
    newOrder.length,
    learning,
  )
}

// The chords actually in play: unlocked and not set aside (§5.2). Every
// generation path filters by this, so a set-aside chord is out of Learn and
// Practice alike — and out of their narrows (worst-chords-only, not-passed-
// only), which draw from the already-filtered pool.
function activeIndices(record: PresetProgressRecord, limit: number): number[] {
  const aside = new Set(record.setAsideIndices)
  const active: number[] = []
  for (let i = 0; i < limit; i++) if (!aside.has(i)) active.push(i)
  return active
}

export function activeChordCount(record: PresetProgressRecord): number {
  return activeIndices(record, record.unlockedCount).length
}

export function isSetAside(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  chordKey: string,
): boolean {
  const index = chordOrder.indexOf(chordKey)
  return index >= 0 && record.setAsideIndices.includes(index)
}

// May this chord be set aside (§5.2)? Only an unlocked chord that is still in
// play, and only while doing so leaves MIN_ACTIVE_CHORDS behind. There is no
// cap on how many may be set aside at once — the floor is the whole limit.
export function canSetAside(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  chordKey: string,
): boolean {
  const index = chordOrder.indexOf(chordKey)
  if (index < 0 || index >= record.unlockedCount) return false
  if (record.setAsideIndices.includes(index)) return false
  return activeChordCount(record) - 1 >= MIN_ACTIVE_CHORDS
}

export function setAsideChord(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  chordKey: string,
  learning: number,
): PresetProgressRecord {
  if (!canSetAside(chordOrder, record, chordKey)) return record
  const index = chordOrder.indexOf(chordKey)
  // Setting aside an item still waiting on its pass leaves the learning window
  // a place short (§5.2), so the next item opens now, as a pass would.
  return settleUnlock(
    {
      ...record,
      setAsideIndices: [...record.setAsideIndices, index].sort((a, b) => a - b),
    },
    chordOrder.length,
    learning,
  )
}

// Opens a chord for play, whichever way it is closed (§5.2) — the single
// action behind Home's *Bring back* and *Unlock now*. A set-aside chord drops
// off that list; a not-yet-reached one drags the unlock frontier forward to
// cover it, which opens every chord before it too (the frontier is a prefix,
// §5.1) — the caller says so on the control rather than doing it silently.
// Passing is untouched either way: a newly opened chord is unlocked and not
// yet passed, so it takes a place in the learning window and the next
// automatic unlock waits on it too.
export function openChord(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  chordKey: string,
): PresetProgressRecord {
  const index = chordOrder.indexOf(chordKey)
  if (index < 0) return record
  if (index >= record.unlockedCount) {
    return { ...record, unlockedCount: index + 1 }
  }
  if (!record.setAsideIndices.includes(index)) return record
  return {
    ...record,
    setAsideIndices: record.setAsideIndices.filter((i) => i !== index),
  }
}

// How many chords ahead of this one an *Unlock now* would open with it (§5.2),
// for the control's label. Zero for anything already unlocked.
export function chordsOpenedBefore(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  chordKey: string,
): number {
  const index = chordOrder.indexOf(chordKey)
  if (index < record.unlockedCount) return 0
  return index - record.unlockedCount
}

// The chords in play as poolChordKeys, for filtering an expansion's combos:
// unlocked and not set aside (§5.2).
export function unlockedChordKeys(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
): ReadonlySet<string> {
  const aside = new Set(record.setAsideIndices)
  return new Set(
    chordOrder.slice(0, record.unlockedCount).filter((_, i) => !aside.has(i)),
  )
}

// The in-play chords that are *not yet* passed, as poolChordKeys — for
// Learn mode's "not passed only" setting (§5.1/§7), which narrows
// generation to chords not yet passed within the unlocked set.
export function notPassedChordKeys(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
): ReadonlySet<string> {
  const passed = new Set(record.masteredIndices)
  const aside = new Set(record.setAsideIndices)
  return new Set(
    chordOrder
      .slice(0, record.unlockedCount)
      .filter((_, index) => !passed.has(index) && !aside.has(index)),
  )
}

// Per-chord status (§7 unlock chip drill-down): every pool chord in unlock
// order, tagged locked/unlocked/passed/set-aside — the same states the
// generator itself gates on, just surfaced instead of aggregated into counts.
// `index` is the chord's place in the unlock order, which is what the §5.2
// controls act on.
export interface ChordPassEntry {
  key: string
  index: number
  unlocked: boolean
  passed: boolean
  setAside: boolean
}

export function chordPassList(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
): ChordPassEntry[] {
  const passed = new Set(record.masteredIndices)
  const aside = new Set(record.setAsideIndices)
  return chordOrder.map((key, index) => ({
    key,
    index,
    unlocked: index < record.unlockedCount,
    passed: passed.has(index),
    setAside: aside.has(index),
  }))
}

export function isFullyUnlocked(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
): boolean {
  return record.unlockedCount >= chordOrder.length
}

// How many more passes until the next item opens (§5.1), for Home's unlock
// line; 0 once the whole pool is open. A pass opens one as soon as fewer than
// `learning` items are waiting, so it is one pass in the steady state — more
// only while items opened by hand crowd the window.
export function passesToNextUnlock(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  learning: number,
): number {
  if (isFullyUnlocked(chordOrder, record)) return 0
  return Math.max(1, waitingCount(record) - learning + 1)
}

export interface ProgressUpdate {
  record: PresetProgressRecord
  changed: boolean
  // True when this attempt opened new chords.
  justUnlocked: boolean
}

// Feeds one Practice-mode outcome into the record, as the chord's grade *after*
// that outcome was recorded (§5.1): a not-yet-passed unlocked chord whose grade
// has reached D passes, and the pass opens the next item in its place (§5). The
// grade is the chord's, not one voicing's — the caller
// folds its combos together (worstChordGrade) — and null (no history at all,
// which an attempt just ruled out) never passes.
//
// Passing is a latch: a chord whose grade later falls back to F stays passed
// and its unlock stays open. The unlock queue is a ratchet — nothing the
// generator does takes back pool the player is mid-drill on — and the
// current grade is already reported live on Home and in Progress, so nothing is
// hidden by the latch. Only the player narrows the pool, by hand and outside a
// session (§5.2 set aside).
export function recordChordAttempt(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
  chordKey: string,
  grade: ComboGrade | null,
  learning: number,
): ProgressUpdate {
  const unchanged: ProgressUpdate = {
    record,
    changed: false,
    justUnlocked: false,
  }
  if (!isPassingGrade(grade)) return unchanged
  const index = chordOrder.indexOf(chordKey)
  if (index < 0 || index >= record.unlockedCount) return unchanged
  if (record.masteredIndices.includes(index)) return unchanged
  const next = settleUnlock(
    {
      ...record,
      masteredIndices: [...record.masteredIndices, index].sort((a, b) => a - b),
    },
    chordOrder.length,
    learning,
  )
  return {
    record: next,
    changed: true,
    justUnlocked: next.unlockedCount > record.unlockedCount,
  }
}

// Items in play and not yet passed: what the learning window counts.
function waitingCount(record: PresetProgressRecord): number {
  const passed = new Set(record.masteredIndices)
  return activeIndices(record, record.unlockedCount).filter(
    (index) => !passed.has(index),
  ).length
}

// The §5.1 gate: while fewer than `learning` items in play are waiting on their
// pass, the next item opens — whatever brought the record there. A pass is the
// usual way, but setting a waiting item aside (§5.2), a pool growing under the
// record and the setting being raised arrive at the same place, and none may
// leave the queue waiting on a pass that can't come: an item already passed
// doesn't pass again. Set-aside items are held out of the window as well as
// out of the pool — one never dealt can never be passed, so counting it as
// waiting would stall the queue for good, the opposite of what setting it
// aside is for. The debt stays visible on Home instead. An item opened by hand
// (§5.2) can leave more than `learning` waiting; nothing opens until passes
// bring it back under.
function settleUnlock(
  record: PresetProgressRecord,
  totalChords: number,
  learning: number,
): PresetProgressRecord {
  const room = learning - waitingCount(record)
  if (room <= 0 || record.unlockedCount >= totalChords) return record
  return {
    ...record,
    unlockedCount: Math.min(record.unlockedCount + room, totalChords),
  }
}

// Convenience for the store: the unlocked subset of an expansion's combos.
export function filterUnlockedCombos(
  combos: readonly Combo[],
  unlocked: ReadonlySet<string>,
): readonly Combo[] {
  const filtered = combos.filter((combo) => unlocked.has(poolChordKey(combo)))
  // Defensive: an inconsistent record must never empty the pool —
  // nextPrompt() relies on a non-empty one (§5).
  return filtered.length > 0 ? filtered : combos
}
