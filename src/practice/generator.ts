import { comboKey, type Combo } from './combos'

// How many recent combos are excluded from the next pick, capped so small
// pools can still generate (DESIGN.md §5): last min(3, poolSize − 1).
export const RECENT_WINDOW = 3

export type Rng = () => number // [0, 1), Math.random-compatible

// Uniform random pick with no immediate repeat. `recentKeys` is the played
// history, oldest first; only the allowed tail of it is excluded. Weighted
// selection by miss rate replaces the uniform pick in Phase 5.
export function pickCombo(
  pool: readonly Combo[],
  recentKeys: readonly string[],
  rng: Rng = Math.random,
): Combo {
  if (pool.length === 0) throw new Error('Cannot pick from an empty pool')

  // slice(-0) would return the whole array, so guard the zero case.
  const excludeCount = Math.min(RECENT_WINDOW, pool.length - 1)
  const excluded = new Set(
    excludeCount === 0 ? [] : recentKeys.slice(-excludeCount),
  )
  const candidates = pool.filter((combo) => !excluded.has(comboKey(combo)))

  const index = Math.min(
    Math.floor(rng() * candidates.length),
    candidates.length - 1,
  )
  const picked = candidates[index]
  if (!picked) throw new Error('Empty candidate pool') // unreachable: excludeCount < pool.length
  return picked
}
