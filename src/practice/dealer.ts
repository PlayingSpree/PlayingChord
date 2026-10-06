// What gets dealt next (DESIGN.md §5): the upcoming preview, the no-repeat
// history it is drawn against, and the chords a mid-session unlock holds back
// until the next session (§5.1). Pure TS.
//
// The caller never resets any of that by hand. It says what happened — items
// unlocked, what is dealable narrowed, the pool was replaced — and the
// dealer decides what each one invalidates. A session starts with a fresh
// dealer, which is what makes last session's unlocks this one's pool.

import { comboKey, type Combo } from './combos'
import {
  fillQueue,
  PREVIEW_SHOWN,
  RECENT_WINDOW,
  UPCOMING_COUNT,
  type Rng,
} from './generator'
import { poolChordKey } from './progress'
import type { RecentStatsSource } from './stats'

export interface DealerDeps {
  stats: RecentStatsSource
  // Read on every deal, so turning the setting off mid-session lets the held
  // chords straight in.
  holdNewUnlocks: () => boolean
  rng?: Rng
}

export interface Deal {
  combo: Combo
  // The §7 preview, next first.
  upcoming: readonly Combo[]
}

export class Dealer {
  readonly #deps: DealerDeps
  #queue: Combo[] = []
  #recentKeys: string[] = []
  #held: ReadonlySet<string> = new Set()

  constructor(deps: DealerDeps) {
    this.#deps = deps
  }

  // Deals from the first candidate pool with anything dealable in it once the
  // held chords are taken out — the caller lists its narrowings (worst only,
  // the learn set, daily's pool) ahead of the whole in-play pool. If held
  // chords empty every one of them, the last is dealt from as it stands: a
  // prompt is always dealt. The last candidate must not be empty.
  deal(candidates: readonly (readonly Combo[])[]): Deal {
    const source = this.#pick(candidates)
    const { stats, rng } = this.#deps
    if (this.#queue.length === 0) {
      this.#queue = fillQueue([], 1, source, this.#recentKeys, stats, rng)
    }
    const combo = this.#queue.shift()
    // Unreachable: fillQueue(_, 1, ...) returns exactly one combo for a
    // non-empty pool, and pickWeightedCombo throws on an empty one.
    if (combo === undefined) throw new Error('Upcoming queue was empty')
    this.#recentKeys.push(comboKey(combo))
    if (this.#recentKeys.length > RECENT_WINDOW) this.#recentKeys.shift()
    this.#queue = fillQueue(
      this.#queue,
      UPCOMING_COUNT,
      source,
      this.#recentKeys,
      stats,
      rng,
    )
    return { combo, upcoming: [...this.#queue] }
  }

  // Items opened mid-session (§5.1): held back while the setting is on — they
  // can't be in the preview then. Off, they join the queue behind the part
  // of the preview on screen: an unlock lands on the ✔, and dropping that
  // part would make the next prompt something other than what the flash was
  // showing. The unseen rest goes, so the new items arrive right after it.
  unlocked(chordKeys: readonly string[]): void {
    if (chordKeys.length === 0) return
    this.#held = new Set([...this.#held, ...chordKeys])
    if (!this.#deps.holdNewUnlocks()) {
      this.#queue = this.#queue.slice(0, PREVIEW_SHOWN)
    }
  }

  // What is dealable changed within the same pool — a mode, worst only, the
  // learn set, a chord set aside or brought back, a library edit. The preview
  // was drawn from the old set, so it goes; the history still names real
  // combos, so it stays.
  narrowed(): void {
    this.#queue = []
  }

  // The pool itself was replaced — another preset or key, a progress wipe, a
  // new unlock order. Everything here named chords of the old one.
  repooled(): void {
    this.#queue = []
    this.#recentKeys = []
    this.#held = new Set()
  }

  #pick(candidates: readonly (readonly Combo[])[]): readonly Combo[] {
    const held = this.#deps.holdNewUnlocks() ? this.#held : new Set<string>()
    for (const combos of candidates) {
      const dealable =
        held.size === 0
          ? combos
          : combos.filter((combo) => !held.has(poolChordKey(combo)))
      if (dealable.length > 0) return dealable
    }
    return candidates[candidates.length - 1] ?? []
  }
}
