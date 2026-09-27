import { describe, expect, it } from 'vitest'
import { ALL_PITCH_CLASSES } from '../theory'
import { comboKey, type Combo } from './combos'
import { Dealer } from './dealer'
import { RECENT_WINDOW, UPCOMING_COUNT } from './generator'
import { poolChordKey } from './progress'
import { NO_HISTORY } from './stats'

function poolOf(size: number): Combo[] {
  return ALL_PITCH_CLASSES.slice(0, size).map((root) => ({
    root,
    typeId: 'maj',
    voicingId: 'any',
  }))
}

// Deterministic LCG, so a failure reproduces.
function seededRng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function dealerWith(hold = true, seed = 1) {
  const setting = { hold }
  const dealer = new Dealer({
    stats: NO_HISTORY,
    holdNewUnlocks: () => setting.hold,
    rng: seededRng(seed),
  })
  return { dealer, setting }
}

const chordOf = (combo: Combo) => poolChordKey(combo)

describe('Dealer — dealing (§5)', () => {
  it('deals the preview in order, keeping it full', () => {
    const { dealer } = dealerWith()
    const pool = poolOf(12)
    const first = dealer.deal([pool])
    expect(first.upcoming).toHaveLength(UPCOMING_COUNT)
    const second = dealer.deal([pool])
    expect(second.combo).toEqual(first.upcoming[0])
    expect(second.upcoming.slice(0, -1)).toEqual(first.upcoming.slice(1))
  })

  it('never repeats a recent combo in a large pool', () => {
    const { dealer } = dealerWith()
    const pool = poolOf(12)
    const recent: string[] = []
    for (let i = 0; i < 200; i++) {
      const { combo } = dealer.deal([pool])
      expect(recent.slice(-RECENT_WINDOW)).not.toContain(comboKey(combo))
      recent.push(comboKey(combo))
    }
  })

  it('deals from the first candidate with anything in it', () => {
    const { dealer } = dealerWith()
    const pool = poolOf(6)
    const narrow = pool.slice(0, 2)
    for (let i = 0; i < 20; i++) {
      expect(narrow).toContainEqual(dealer.deal([[], narrow, pool]).combo)
      dealer.narrowed()
    }
  })
})

describe('Dealer — held unlocks (§5.1)', () => {
  it('keeps an opened batch out of dealing while the setting is on', () => {
    const { dealer } = dealerWith(true)
    const pool = poolOf(6)
    const opened = pool.slice(3).map(chordOf)
    dealer.unlocked(opened)
    for (let i = 0; i < 50; i++) {
      const { combo, upcoming } = dealer.deal([pool])
      for (const c of [combo, ...upcoming]) {
        expect(opened).not.toContain(chordOf(c))
      }
    }
  })

  it('lets them in at once when the setting is off, preview included', () => {
    const { dealer } = dealerWith(false)
    const pool = poolOf(2)
    const [a, b] = pool as [Combo, Combo]
    // Fill the preview from `a` alone, then open `b`.
    dealer.deal([[a]])
    dealer.unlocked([chordOf(b)])
    const dealt = [dealer.deal([pool])]
    for (let i = 0; i < 10; i++) dealt.push(dealer.deal([pool]))
    // The stale all-`a` preview was dropped, so `b` shows up.
    expect(dealt.flatMap((d) => [d.combo, ...d.upcoming])).toContainEqual(b)
  })

  it('reads the setting on every deal', () => {
    const { dealer, setting } = dealerWith(true)
    const pool = poolOf(4)
    const opened = chordOf(pool[3]!)
    dealer.unlocked([opened])
    setting.hold = false
    dealer.narrowed()
    const seen = new Set<string>()
    for (let i = 0; i < 40; i++) seen.add(chordOf(dealer.deal([pool]).combo))
    expect(seen).toContain(opened)
  })

  it('falls through a candidate that only held chords fill', () => {
    const { dealer } = dealerWith(true)
    const pool = poolOf(6)
    const worst = pool.slice(4)
    dealer.unlocked(worst.map(chordOf))
    const { combo } = dealer.deal([worst, pool])
    expect(worst).not.toContainEqual(combo)
  })

  it('deals the last candidate as it stands if held chords empty them all', () => {
    const { dealer } = dealerWith(true)
    const pool = poolOf(2)
    dealer.unlocked(pool.map(chordOf))
    expect(pool).toContainEqual(dealer.deal([pool]).combo)
  })

  it('forgets held chords when the pool is replaced', () => {
    const { dealer } = dealerWith(true)
    const pool = poolOf(2)
    const [a, b] = pool as [Combo, Combo]
    dealer.unlocked([chordOf(b)])
    dealer.repooled()
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) seen.add(comboKey(dealer.deal([pool]).combo))
    expect(seen).toEqual(new Set([comboKey(a), comboKey(b)]))
  })
})

describe('Dealer — invalidation', () => {
  it('narrowed drops the preview, so the next deal draws from the new set', () => {
    const { dealer } = dealerWith()
    const pool = poolOf(12)
    dealer.deal([pool])
    dealer.narrowed()
    const narrow = pool.slice(0, 3)
    const { combo, upcoming } = dealer.deal([narrow])
    for (const c of [combo, ...upcoming]) expect(narrow).toContainEqual(c)
  })

  it('narrowed keeps the history, so the last combo is not dealt again', () => {
    const { dealer } = dealerWith()
    const pool = poolOf(4)
    for (let i = 0; i < 30; i++) {
      const last = dealer.deal([pool]).combo
      dealer.narrowed()
      expect(dealer.deal([pool]).combo).not.toEqual(last)
    }
  })

  it('a batch opened with nothing in it changes nothing', () => {
    const { dealer } = dealerWith(false)
    const pool = poolOf(12)
    const first = dealer.deal([pool])
    dealer.unlocked([])
    expect(dealer.deal([pool]).combo).toEqual(first.upcoming[0])
  })
})
