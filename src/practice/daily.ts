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

import { comboKey, type Combo, type Side } from './combos'
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

// Chords first: the quicker kind, and the warm-up for the longer runs.
const DAILY_LEG_ORDER: readonly Side[] = ['chords', 'scales']

// Under this much left (10 s), a leg counts as done — a leg ended a breath
// short of its share shouldn't come back as a seconds-long session of its own.
const DAILY_LEG_DONE_SLACK_MINUTES = 1 / 6

// Everything the two legs are sized from (§5.3): the persisted cap and split,
// how many items each side has learned, and how many Daily minutes each side
// has already played today.
export interface DailyPlan {
  capMinutes: number
  chordShare: number
  learned: Readonly<Record<Side, number>>
  playedToday: Readonly<Record<Side, number>>
}

// A leg's share of the cap. A kind with nothing learned has nothing to
// drill, so its leg is skipped and the other kind takes the whole cap — a
// player who hasn't started scales shouldn't find half the drill missing.
// 0 means the leg doesn't run at all.
export function dailyLegMinutes(side: Side, plan: DailyPlan): number {
  if (plan.learned[side] === 0) return 0
  const other: Side = side === 'chords' ? 'scales' : 'chords'
  if (plan.learned[other] === 0) return plan.capMinutes
  const share = side === 'chords' ? plan.chordShare : 1 - plan.chordShare
  return plan.capMinutes * share
}

// What is left of a leg today: its share less the Daily minutes this side
// has played since midnight, so a leg ended early resumes with its remainder
// and a finished one doesn't run again. 0 once within the slack of done.
export function dailyLegRemaining(side: Side, plan: DailyPlan): number {
  const left = dailyLegMinutes(side, plan) - plan.playedToday[side]
  return left < DAILY_LEG_DONE_SLACK_MINUTES ? 0 : left
}

// The leg Daily runs next — the first, in leg order, with time left today —
// or null when today's Daily is done (or there is nothing learned to run).
export function dueDailyLeg(plan: DailyPlan): Side | null {
  return (
    DAILY_LEG_ORDER.find((side) => dailyLegRemaining(side, plan) > 0) ?? null
  )
}
