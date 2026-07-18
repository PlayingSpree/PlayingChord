import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spellRoot } from '../theory'
import { DEFAULT_PRACTICE_SETTINGS, type PracticeSettings } from './settings'
import {
  buildProgression,
  romanNumeral,
  SONG_BEATS_PER_BAR,
  SONG_LOOPS_PER_PHRASE,
  songChordLabel,
  SongEngine,
  type SongChord,
  type SongState,
} from './song'

// 60 BPM default → one beat per second.
const BEAT = 60_000 / DEFAULT_PRACTICE_SETTINGS.songTempoBpm
const BAR = BEAT * SONG_BEATS_PER_BAR

describe('buildProgression (§6.5)', () => {
  it('starts on I and respects the chord count', () => {
    for (const count of [2, 3, 4]) {
      const progression = buildProgression(0, count, () => 0.5)
      expect(progression).toHaveLength(count)
      expect(progression[0]).toEqual({ degree: 0, root: 0, typeId: 'maj' })
    }
  })

  it('never picks vii° and never repeats a chord', () => {
    for (let seed = 0; seed < 20; seed++) {
      let calls = 0
      const rng = () => (((seed + 1) * (calls++ + 7)) % 13) / 13
      const progression = buildProgression(2, 4, rng)
      const degrees = progression.map((c) => c.degree)
      expect(degrees).not.toContain(6)
      expect(new Set(degrees).size).toBe(degrees.length)
    }
  })

  it('resolves roots and qualities from the key', () => {
    // rng always 0 picks the lowest remaining degree: I ii iii IV in G.
    expect(buildProgression(7, 4, () => 0)).toEqual([
      { degree: 0, root: 7, typeId: 'maj' },
      { degree: 1, root: 9, typeId: 'min' },
      { degree: 2, root: 11, typeId: 'min' },
      { degree: 3, root: 0, typeId: 'maj' },
    ])
  })

  it('clamps a junk chord count into 2-4', () => {
    expect(buildProgression(0, 99, () => 0)).toHaveLength(4)
    expect(buildProgression(0, 1, () => 0)).toHaveLength(2)
  })
})

describe('romanNumeral / songChordLabel', () => {
  it('names all seven degrees', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(romanNumeral)).toEqual([
      'I',
      'ii',
      'iii',
      'IV',
      'V',
      'vi',
      'vii°',
    ])
  })

  it('labels chips compactly', () => {
    expect(songChordLabel(spellRoot(0), 'maj')).toBe('C')
    expect(songChordLabel(spellRoot(9), 'min')).toBe('Am')
  })
})

describe('SongEngine (§6.5 clock-paced lifecycle)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function harness(overrides: Partial<PracticeSettings> = {}) {
    let settings: PracticeSettings = {
      ...DEFAULT_PRACTICE_SETTINGS,
      ...overrides,
    }
    const states: SongState[] = []
    const barResults: { chord: SongChord; hit: boolean }[] = []
    const engine = new SongEngine({
      settings: () => settings,
      now: () => Date.now(),
      rng: () => 0, // deterministic: lowest remaining degree each pick
      onState: (state) => states.push(state),
      onBarResult: (chord, hit) => barResults.push({ chord, hit }),
    })
    return {
      engine,
      states,
      barResults,
      last: () => states[states.length - 1]!,
      updateSettings(patch: Partial<PracticeSettings>) {
        settings = { ...settings, ...patch }
      },
    }
  }

  // rng () => 0 in C major: I ii iii IV = C maj, D min, E min, F maj.
  const C_MAJOR = new Set([60, 64, 67])
  const D_MINOR = new Set([62, 65, 69])

  it('counts in for one bar, emitting a beat per interval', () => {
    const h = harness()
    h.engine.start(0)
    expect(h.states).toHaveLength(1)
    expect(h.last()).toMatchObject({ countingIn: true, beat: 0, beatInBar: 0 })

    vi.advanceTimersByTime(BEAT * 3)
    expect(h.last()).toMatchObject({ countingIn: true, beat: 3, beatInBar: 3 })
    expect(h.barResults).toHaveLength(0)

    vi.advanceTimersByTime(BEAT)
    expect(h.last()).toMatchObject({
      countingIn: false,
      loopIndex: 0,
      barIndex: 0,
      beat: 4,
      beatInBar: 0,
    })
  })

  it('judges notes already held when the bar starts (legato)', () => {
    const h = harness()
    h.engine.start(0)
    h.engine.heldChange(C_MAJOR)
    expect(h.last().hitCount).toBe(0) // count-in never judges

    vi.advanceTimersByTime(BAR) // count-in over, bar 0 begins
    expect(h.last().hitCount).toBe(1)
    expect(h.last().results).toEqual([null, null, null, null])

    vi.advanceTimersByTime(BAR) // bar 0 completes
    expect(h.barResults).toEqual([
      { chord: { degree: 0, root: 0, typeId: 'maj' }, hit: true },
    ])
    expect(h.last().results).toEqual([true, null, null, null])
    expect(h.last().barIndex).toBe(1)
  })

  it('a mid-bar match counts as a hit, stamped only at bar end', () => {
    const h = harness()
    h.engine.start(0)
    vi.advanceTimersByTime(BAR + BEAT) // one beat into bar 0
    h.engine.heldChange(C_MAJOR)
    expect(h.last().hitCount).toBe(1)
    expect(h.last().results).toEqual([null, null, null, null])
    h.engine.heldChange(new Set())
    vi.advanceTimersByTime(BAR - BEAT)
    expect(h.last().results).toEqual([true, null, null, null])
  })

  it('an untouched or wrong bar is a miss at the boundary', () => {
    const h = harness()
    h.engine.start(0)
    vi.advanceTimersByTime(BAR) // bar 0 (C maj) starts
    h.engine.heldChange(new Set([60, 61])) // C + C# — never matches
    h.engine.heldChange(new Set())
    vi.advanceTimersByTime(BAR) // bar 0 → miss; bar 1 (D min) starts
    vi.advanceTimersByTime(BAR) // bar 1 untouched → miss
    expect(h.barResults.map((r) => r.hit)).toEqual([false, false])
    expect(h.last().results).toEqual([false, false, null, null])
  })

  it('a hit is not double-counted within a bar', () => {
    const h = harness()
    h.engine.start(0)
    vi.advanceTimersByTime(BAR)
    h.engine.heldChange(C_MAJOR)
    h.engine.heldChange(new Set())
    h.engine.heldChange(C_MAJOR)
    expect(h.last().hitCount).toBe(1)
  })

  it('match settings flow into judging', () => {
    const h = harness({ strictExtraNotes: false })
    h.engine.start(0)
    vi.advanceTimersByTime(BAR)
    h.engine.heldChange(new Set([...C_MAJOR, 61])) // extra note tolerated
    expect(h.last().hitCount).toBe(1)

    const strict = harness()
    strict.engine.start(0)
    vi.advanceTimersByTime(BAR)
    strict.engine.heldChange(new Set([...C_MAJOR, 61]))
    expect(strict.states[strict.states.length - 1]!.hitCount).toBe(0)
  })

  it('loops the progression and summarizes the phrase into the next count-in', () => {
    const h = harness()
    h.engine.start(0)
    // Hold C maj forever: every C-maj bar hits, everything else misses.
    h.engine.heldChange(C_MAJOR)

    const phraseBars = 4 * SONG_LOOPS_PER_PHRASE
    vi.advanceTimersByTime(BAR + phraseBars * BAR) // count-in + full phrase
    expect(h.barResults).toHaveLength(phraseBars)

    const state = h.last()
    expect(state.countingIn).toBe(true)
    expect(state.phraseSummary).not.toBeNull()
    expect(
      state.phraseSummary!.map((s) => ({ hits: s.hits, loops: s.loops })),
    ).toEqual([
      { hits: SONG_LOOPS_PER_PHRASE, loops: SONG_LOOPS_PER_PHRASE }, // C maj
      { hits: 0, loops: SONG_LOOPS_PER_PHRASE },
      { hits: 0, loops: SONG_LOOPS_PER_PHRASE },
      { hits: 0, loops: SONG_LOOPS_PER_PHRASE },
    ])
    // A fresh progression is live and the summary clears when bars resume.
    vi.advanceTimersByTime(BAR)
    expect(h.last().phraseSummary).toBeNull()
    expect(h.last().countingIn).toBe(false)
    // The second D-min bar of the new phrase still judges correctly.
    vi.advanceTimersByTime(BAR)
    h.engine.heldChange(D_MINOR)
    expect(h.last().hitCount).toBeGreaterThan(SONG_LOOPS_PER_PHRASE)
  })

  it('reads tempo fresh each beat', () => {
    const h = harness()
    h.engine.start(0)
    h.updateSettings({ songTempoBpm: 120 }) // 500 ms beats from the next tick
    vi.advanceTimersByTime(BEAT) // the already-scheduled 1000 ms beat
    expect(h.last().beat).toBe(1)
    vi.advanceTimersByTime(500)
    expect(h.last().beat).toBe(2)
    vi.advanceTimersByTime(499)
    expect(h.last().beat).toBe(2)
    vi.advanceTimersByTime(1)
    expect(h.last().beat).toBe(3)
  })

  it('does not drift: beats stay locked to absolute time', () => {
    const h = harness({ songTempoBpm: 100 }) // 600 ms
    h.engine.start(0)
    vi.advanceTimersByTime(600 * 60)
    expect(h.last().beat).toBe(60)
  })

  it('setKey rebuilds the progression and counts in again, recording nothing', () => {
    const h = harness()
    h.engine.start(0)
    vi.advanceTimersByTime(BAR + BEAT) // one beat into bar 0
    h.engine.setKey(7)
    expect(h.barResults).toHaveLength(0) // in-flight bar abandoned silently
    const state = h.last()
    expect(state.countingIn).toBe(true)
    expect(state.progression[0]).toEqual({ degree: 0, root: 7, typeId: 'maj' })
    expect(state.phraseSummary).toBeNull()
  })

  it('stop() halts the clock silently', () => {
    const h = harness()
    h.engine.start(0)
    vi.advanceTimersByTime(BAR)
    const emitted = h.states.length
    h.engine.stop()
    vi.advanceTimersByTime(BAR * 10)
    expect(h.states).toHaveLength(emitted)
    expect(h.barResults).toHaveLength(0)
    h.engine.heldChange(C_MAJOR) // ignored while stopped
    expect(h.states).toHaveLength(emitted)
  })

  it('chord count is read at each new progression', () => {
    const h = harness({ songChordCount: 2 })
    h.engine.start(0)
    expect(h.last().progression).toHaveLength(2)
    h.updateSettings({ songChordCount: 3 })
    // Finish the phrase: count-in + 2 bars × loops.
    vi.advanceTimersByTime(BAR + 2 * SONG_LOOPS_PER_PHRASE * BAR)
    expect(h.last().progression).toHaveLength(3)
  })
})
