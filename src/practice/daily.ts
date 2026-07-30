// The daily-practice pool (DESIGN.md §5.3): every chord the player has
// already *learned* — passed, in the §5.1 sense — wherever they learned it,
// drilled as one pool under a time cap. Pure TS; the store supplies each
// preset's expansion and reconciled progress record, this folds them together.
//
// Two consequences fall out of "passed only" and are the reason it is drawn
// that way. Nothing in the pool can pass (it already has), so daily practice
// never moves the unlock queue — learning stays in Learn and free practice.
// And a chord set aside by hand (§5.2) is out of it, in whichever preset it
// was benched: the bench is a statement about playing the chord, not about one
// preset.

import { comboKey, type Combo } from './combos'
import { poolChordKey, type PresetProgressRecord } from './progress'

// One preset's contribution: its expanded combos (§4) in pool order, the
// unlock order those indices are into (§5.1), and its reconciled record.
export interface DailyPresetSource {
  combos: readonly Combo[]
  chordOrder: readonly string[]
  record: PresetProgressRecord
}

// The passed, still-in-play chords of one preset, as poolChordKeys. Set-aside
// indices are excluded even though a set-aside chord may well be passed —
// §5.2 takes it out of play, and daily practice is play.
function learnedChordKeys(
  chordOrder: readonly string[],
  record: PresetProgressRecord,
): ReadonlySet<string> {
  const aside = new Set(record.setAsideIndices)
  const keys = new Set<string>()
  for (const index of record.masteredIndices) {
    if (aside.has(index)) continue
    const key = chordOrder[index]
    if (key !== undefined) keys.add(key)
  }
  return keys
}

// The union of every source's learned combos, deduplicated by combo key —
// the same chord under the same voicing rule is one drillable thing however
// many presets happen to contain it, and stats are keyed that way too (§5).
// Source order is preserved, so the pool reads in preset order; the weighted
// draw (§5) reorders it anyway.
export function dailyPool(sources: readonly DailyPresetSource[]): Combo[] {
  const seen = new Set<string>()
  const pool: Combo[] = []
  for (const source of sources) {
    const learned = learnedChordKeys(source.chordOrder, source.record)
    for (const combo of source.combos) {
      if (!learned.has(poolChordKey(combo))) continue
      const key = comboKey(combo)
      if (seen.has(key)) continue
      seen.add(key)
      pool.push(combo)
    }
  }
  return pool
}

// How many distinct *chords* (not combos) the pool covers — what Home and the
// session sheet report, since "learned chords" is the unit the player counts
// in, and one chord can carry several voicing combos.
export function dailyChordCount(pool: readonly Combo[]): number {
  return new Set(pool.map(poolChordKey)).size
}
