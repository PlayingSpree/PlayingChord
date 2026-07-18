import { comboKey, type Combo } from './combos'
import {
  NO_HISTORY,
  type ComboRecentHistory,
  type RecentStatsSource,
} from './stats'

// How many recent combos are excluded from the next pick, capped so small
// pools can still generate (DESIGN.md §5): last min(3, poolSize − 1).
export const RECENT_WINDOW = 3

// How strongly recent misses attract the generator (§5): a combo missed on
// every recent attempt is 1 + MISS_WEIGHT_BOOST times as likely as a fresh
// one — a subtle bias, not a takeover.
export const MISS_WEIGHT_BOOST = 3

export type Rng = () => number // [0, 1), Math.random-compatible

// Baseline 1 for no history keeps a fresh preset uniform-random (§5); a
// clean recent record also stays at baseline — success never down-weights.
export function comboWeight(history: ComboRecentHistory | null): number {
  if (history === null || history.total === 0) return 1
  return 1 + MISS_WEIGHT_BOOST * (history.misses / history.total)
}

// Miss-weighted random pick with no immediate repeat. `recentKeys` is the
// played history, oldest first; only the allowed tail of it is excluded.
// `window` widens the exclusion for queued-but-not-yet-played picks (§5's
// upcoming preview): the caller passes RECENT_WINDOW + however many combos
// are already queued, so the preview and the current prompt stay
// duplicate-free whenever the pool is large enough.
export function pickWeightedCombo(
  pool: readonly Combo[],
  recentKeys: readonly string[],
  stats: RecentStatsSource,
  rng: Rng = Math.random,
  window: number = RECENT_WINDOW,
): Combo {
  if (pool.length === 0) throw new Error('Cannot pick from an empty pool')

  // slice(-0) would return the whole array, so guard the zero case.
  const excludeCount = Math.min(window, pool.length - 1)
  const excluded = new Set(
    excludeCount === 0 ? [] : recentKeys.slice(-excludeCount),
  )
  const candidates = pool.filter((combo) => !excluded.has(comboKey(combo)))

  const weights = candidates.map((combo) =>
    comboWeight(stats.recentHistory(comboKey(combo))),
  )
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  let remaining = rng() * total
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    const weight = weights[i]
    if (candidate === undefined || weight === undefined) break
    remaining -= weight
    if (remaining < 0) return candidate
  }
  // rng() of ~1 can walk past the end on floating-point rounding.
  const last = candidates[candidates.length - 1]
  if (!last) throw new Error('Empty candidate pool') // unreachable: excludeCount < pool.length
  return last
}

// Uniform pick = weighted pick where nothing has history.
export function pickCombo(
  pool: readonly Combo[],
  recentKeys: readonly string[],
  rng: Rng = Math.random,
): Combo {
  return pickWeightedCombo(pool, recentKeys, NO_HISTORY, rng)
}

// How many upcoming combos the §7 preview shows.
export const UPCOMING_COUNT = 4

// Extends `queue` up to `count` combos (§5's upcoming preview), appending
// picks against then-current weights — later slots are dealt with with
// yesterday's weights once anything is recorded in between, a Tetris-preview
// staleness accepted by design. Each appended pick excludes the played
// history plus everything already queued, so the preview and the current
// prompt stay duplicate-free whenever the pool is large enough; a pool too
// small for `count` distinct combos repeats rather than throwing.
export function fillQueue(
  queue: readonly Combo[],
  count: number,
  pool: readonly Combo[],
  recentKeys: readonly string[],
  stats: RecentStatsSource,
  rng: Rng = Math.random,
): Combo[] {
  const filled = [...queue]
  while (filled.length < count) {
    const excluded = [...recentKeys, ...filled.map((combo) => comboKey(combo))]
    filled.push(
      pickWeightedCombo(
        pool,
        excluded,
        stats,
        rng,
        RECENT_WINDOW + filled.length,
      ),
    )
  }
  return filled
}
