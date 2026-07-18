import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chordPitchClasses,
  voicingLibrary,
  type PitchClass,
  type VoicingRule,
} from '../theory'
import {
  comboKey,
  DEFAULT_PRACTICE_SETTINGS,
  InMemoryComboStats,
  type ChordPool,
  type Preset,
  type Prompt,
} from '../practice'
import { InMemoryDailyActivity } from '../storage'
import { createPracticeStore, type PresetMemory } from './practiceStore'

const ADVANCE = DEFAULT_PRACTICE_SETTINGS.autoAdvanceMs
const STALL = DEFAULT_PRACTICE_SETTINGS.judgmentDelayMs

// Single-preset harness replacing the Phase 3/4 `pool` dep.
function presetsOf(
  pool: ChordPool,
  voicingIds: readonly string[] = ['any'],
): () => readonly Preset[] {
  return () => [{ id: 'test', name: 'Test', pool, voicingIds }]
}

function memoryStub(
  initial: Partial<{ presetId: string; diatonicKey: PitchClass }> | null = null,
): PresetMemory & { saved: unknown[] } {
  const saved: unknown[] = []
  return {
    saved,
    load: () => initial,
    save: (selection) => saved.push(selection),
  }
}

function setup(deps: Parameters<typeof createPracticeStore>[0] = {}) {
  const store = createPracticeStore({
    settings: () => DEFAULT_PRACTICE_SETTINGS, // independent of localStorage
    memory: memoryStub(),
    stats: new InMemoryComboStats(), // never the shared appStorage singleton
    activity: new InMemoryDailyActivity(),
    ...deps,
  })
  let held = new Set<number>()
  const press = (...notes: number[]) => {
    held = new Set([...held, ...notes])
    store.getState().onHeldChange(held)
  }
  const release = (...notes: number[]) => {
    held = new Set([...held].filter((n) => !notes.includes(n)))
    store.getState().onHeldChange(held)
  }
  const releaseAll = () => {
    held = new Set()
    store.getState().onHeldChange(held)
  }
  store.getState().start()
  return { store, press, release, releaseAll }
}

// A correct voicing for the current prompt: compact chord tones above C4.
function correctNotes(prompt: Prompt): number[] {
  return chordPitchClasses(prompt.chord).map((pc) => 60 + pc)
}

function promptComboKey(prompt: Prompt): string {
  return comboKey({
    root: prompt.chord.root,
    typeId: prompt.chord.type.id,
    voicingId: prompt.voicing.id,
  })
}

const playCorrectAndAdvance = (s: ReturnType<typeof setup>, prompt: Prompt) => {
  s.press(...correctNotes(prompt))
  s.releaseAll()
  vi.advanceTimersByTime(ADVANCE)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('practiceStore — arming (§6.2 step 1)', () => {
  it('starts armed when no keys are held', () => {
    const { store } = setup()
    expect(store.getState().phase).toBe('armed')
    expect(store.getState().prompt).not.toBeNull()
  })

  it('is idempotent on start (StrictMode double-mount)', () => {
    const { store } = setup()
    const prompt = store.getState().prompt
    store.getState().start()
    expect(store.getState().prompt).toBe(prompt)
  })

  it('held-over notes never judge the next prompt', () => {
    const { store, press, releaseAll } = setup()
    const first = store.getState().prompt!
    press(...correctNotes(first))
    expect(store.getState().phase).toBe('advancing')

    // Still holding the correct chord when the next prompt appears…
    vi.advanceTimersByTime(ADVANCE)
    expect(store.getState().prompt).not.toBe(first)
    expect(store.getState().phase).toBe('awaiting-release')

    // …even if it also happens to satisfy the new prompt, nothing judges
    // until everything is released and replayed.
    const second = store.getState().prompt!
    press(...correctNotes(second))
    expect(store.getState().phase).toBe('awaiting-release')

    releaseAll()
    expect(store.getState().phase).toBe('armed')
    press(...correctNotes(second))
    expect(store.getState().phase).toBe('advancing')
  })
})

describe('practiceStore — correct path', () => {
  it('flags correct with a reaction time and auto-advances', () => {
    const { store, press } = setup()
    const prompt = store.getState().prompt!

    vi.advanceTimersByTime(1200) // "thinking" — Date.now is faked too
    press(...correctNotes(prompt))

    expect(store.getState().phase).toBe('advancing')
    expect(store.getState().reactionMs).toBe(1200)

    vi.advanceTimersByTime(ADVANCE - 1)
    expect(store.getState().prompt).toBe(prompt)
    vi.advanceTimersByTime(1)
    expect(store.getState().prompt).not.toBe(prompt)
    // The correct chord is still held, so the new prompt is not yet armed.
    expect(store.getState().phase).toBe('awaiting-release')
  })

  it('judges on every held-set change, not only complete chords', () => {
    const { store, press } = setup()
    const prompt = store.getState().prompt!
    const [a, b, c] = correctNotes(prompt)

    press(a!)
    expect(store.getState().phase).toBe('armed')
    press(b!)
    expect(store.getState().phase).toBe('armed')
    press(c!)
    expect(store.getState().phase).toBe('advancing')
  })

  it('notes during the advance window are ignored', () => {
    const { store, press, releaseAll } = setup()
    const first = store.getState().prompt!
    press(...correctNotes(first))
    releaseAll()

    // Mash keys mid-window: no judgment, no re-advance.
    press(35, 36, 37)
    expect(store.getState().phase).toBe('advancing')
    releaseAll()

    vi.advanceTimersByTime(ADVANCE)
    expect(store.getState().phase).toBe('armed') // empty hands → armed directly
  })

  it('a correct chord released before the advance still advances armed', () => {
    const { store, press, releaseAll } = setup()
    press(...correctNotes(store.getState().prompt!))
    releaseAll()
    vi.advanceTimersByTime(ADVANCE)
    expect(store.getState().phase).toBe('armed')
  })
})

describe('practiceStore — miss & retry (§6.2 steps 2–3)', () => {
  it('latches a definitive miss with a hint and retries to correct', () => {
    const { store, press, releaseAll } = setup()
    const prompt = store.getState().prompt!

    press(61, 62, 63) // chromatic cluster — no major triad contains all three
    expect(store.getState().phase).toBe('missed')
    expect(store.getState().missCount).toBe(1)
    expect(store.getState().hint?.kind).toBe('wrong-keys')

    releaseAll()
    expect(store.getState().phase).toBe('armed')
    press(...correctNotes(prompt))
    expect(store.getState().phase).toBe('advancing')
    expect(store.getState().prompt).toBe(prompt) // same prompt survived the miss
  })

  it('misses stalled wrong attempts after the judgment delay', () => {
    const presets = presetsOf(
      { kind: 'explicit', chords: [{ root: 0, typeId: 'maj' }] },
      ['first-inversion'],
    )
    const { store, press } = setup({ presets })

    press(60, 64, 67) // root position in an inversion drill
    expect(store.getState().phase).toBe('armed')
    vi.advanceTimersByTime(STALL)
    expect(store.getState().phase).toBe('missed')
    expect(store.getState().hint).toEqual({
      kind: 'constraint',
      text: 'Bass must be the 3rd',
    })
  })
})

describe('practiceStore — skip (§6.2 step 4)', () => {
  it('advances to a new prompt immediately', () => {
    const { store } = setup()
    const first = store.getState().prompt!
    store.getState().skip()
    expect(store.getState().prompt).not.toBe(first)
    expect(store.getState().phase).toBe('armed')
    expect(store.getState().missCount).toBe(0)
  })

  it('clears any hint from the skipped prompt', () => {
    const { store, press, releaseAll } = setup()
    press(61, 62, 63)
    expect(store.getState().hint).not.toBeNull()
    releaseAll()
    store.getState().skip()
    expect(store.getState().hint).toBeNull()
  })
})

describe('practiceStore — generation', () => {
  it('never repeats a prompt within the recent window', () => {
    const presets = presetsOf({
      kind: 'product',
      roots: [0, 1, 2, 3, 4, 5],
      chordTypes: ['maj'],
    })
    const s = setup({ presets })
    const seen: string[] = []

    for (let i = 0; i < 50; i++) {
      const prompt = s.store.getState().prompt!
      expect(seen.slice(-3)).not.toContain(promptComboKey(prompt))
      seen.push(promptComboKey(prompt))
      playCorrectAndAdvance(s, prompt)
    }
  })
})

describe('practiceStore — upcoming queue (§5/§7)', () => {
  const bigPreset = presetsOf({
    kind: 'product',
    roots: [0, 1, 2, 3, 4, 5],
    chordTypes: ['maj'],
  })

  it('shows 4 labeled entries immediately after start', () => {
    const s = setup({ presets: bigPreset })
    expect(s.store.getState().upcoming).toHaveLength(4)
    s.store.getState().upcoming.forEach((u) => {
      expect(u.key).toBeTruthy()
      expect(u.label).toBeTruthy()
    })
  })

  it('deals the queue head next and appends one item on advance', () => {
    const s = setup({ presets: bigPreset })
    const before = s.store.getState().upcoming
    const prompt = s.store.getState().prompt!

    playCorrectAndAdvance(s, prompt)

    expect(promptComboKey(s.store.getState().prompt!)).toBe(before[0]!.key)
    const after = s.store.getState().upcoming
    expect(after).toHaveLength(4)
    expect(after.slice(0, 3)).toEqual(before.slice(1))
  })

  it('the current prompt and upcoming queue share no duplicate keys', () => {
    const s = setup({ presets: bigPreset })
    for (let i = 0; i < 20; i++) {
      const prompt = s.store.getState().prompt!
      const keys = [
        promptComboKey(prompt),
        ...s.store.getState().upcoming.map((u) => u.key),
      ]
      expect(new Set(keys).size).toBe(keys.length)
      playCorrectAndAdvance(s, prompt)
    }
  })

  it('rebuilds the queue from the new pool on setPreset', () => {
    const s = setup() // default deps: real built-in presets
    s.store.getState().setPreset('seventh-chords')

    const seventhTypeIds = new Set(['maj7', 'min7', 'dom7'])
    const keys = [
      promptComboKey(s.store.getState().prompt!),
      ...s.store.getState().upcoming.map((u) => u.key),
    ]
    keys.forEach((key) => {
      const typeId = key.split(':')[1]!
      expect(seventhTypeIds.has(typeId)).toBe(true)
    })
  })

  it('rebuilds the queue from the worst-only pool on setWorstOnly', () => {
    const stats = new InMemoryComboStats()
    const explicit = presetsOf({
      kind: 'explicit',
      chords: [
        { root: 0, typeId: 'maj' },
        { root: 1, typeId: 'maj' },
        { root: 2, typeId: 'maj' },
      ],
    })
    stats.record('0:maj:any', 'missed', 4000)
    const s = setup({ presets: explicit, stats })

    s.store.getState().setWorstOnly(true)

    expect(s.store.getState().upcoming.length).toBeGreaterThan(0)
    const keys = [
      promptComboKey(s.store.getState().prompt!),
      ...s.store.getState().upcoming.map((u) => u.key),
    ]
    keys.forEach((key) => expect(key).toBe('0:maj:any'))
  })

  it('a single-combo pool previews 4 copies of the only combo', () => {
    const onePreset = presetsOf({
      kind: 'explicit',
      chords: [{ root: 0, typeId: 'maj' }],
    })
    const s = setup({ presets: onePreset })
    expect(s.store.getState().upcoming).toHaveLength(4)
    s.store.getState().upcoming.forEach((u) => expect(u.key).toBe('0:maj:any'))
  })
})

describe('practiceStore — outcome recording (§5/§7)', () => {
  const onePreset = presetsOf({
    kind: 'explicit',
    chords: [{ root: 0, typeId: 'maj' }],
  })

  it('records a first-try success', () => {
    const stats = new InMemoryComboStats()
    const s = setup({ presets: onePreset, stats })
    const prompt = s.store.getState().prompt!
    playCorrectAndAdvance(s, prompt)
    expect(stats.recentHistory(promptComboKey(prompt))).toEqual({
      misses: 0,
      total: 1,
    })
  })

  it('records a missed-then-corrected prompt as a miss', () => {
    const stats = new InMemoryComboStats()
    const s = setup({ presets: onePreset, stats })
    const prompt = s.store.getState().prompt!

    s.press(61, 62, 63)
    expect(s.store.getState().phase).toBe('missed')
    s.releaseAll()
    playCorrectAndAdvance(s, prompt)

    expect(stats.recentHistory(promptComboKey(prompt))).toEqual({
      misses: 1,
      total: 1,
    })
  })

  it('records nothing for a skip, even after a miss (§6.2 step 4)', () => {
    const stats = new InMemoryComboStats()
    const s = setup({ presets: onePreset, stats })
    const prompt = s.store.getState().prompt!

    s.press(61, 62, 63)
    s.releaseAll()
    s.store.getState().skip()

    expect(stats.recentHistory(promptComboKey(prompt))).toBeNull()
  })
})

describe('practiceStore — session stats & worst chords (§7)', () => {
  const onePreset = presetsOf({
    kind: 'explicit',
    chords: [{ root: 0, typeId: 'maj' }],
  })

  it('tallies prompts, first-try successes and time-to-correct', () => {
    const s = setup({ presets: onePreset })

    vi.advanceTimersByTime(1000)
    playCorrectAndAdvance(s, s.store.getState().prompt!) // first-try, 1000 ms

    const second = s.store.getState().prompt!
    s.press(61, 62, 63) // miss…
    s.releaseAll()
    vi.advanceTimersByTime(2000)
    playCorrectAndAdvance(s, second) // …then correct after 2000 ms total

    expect(s.store.getState().session).toEqual({
      prompts: 2,
      firstTrySuccesses: 1,
      totalTimeToCorrectMs: 3000,
    })
  })

  it('skips leave the session tallies untouched', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().skip()
    s.press(61, 62, 63) // even a missed-then-skipped prompt stays out
    s.releaseAll()
    s.store.getState().skip()
    expect(s.store.getState().session.prompts).toBe(0)
  })

  it('lists missed combos under worst chords with lifetime accuracy', () => {
    const s = setup({ presets: onePreset })
    expect(s.store.getState().worstChords).toEqual([])

    const prompt = s.store.getState().prompt!
    s.press(61, 62, 63)
    s.releaseAll()
    playCorrectAndAdvance(s, prompt)

    expect(s.store.getState().worstChords).toEqual([
      { key: '0:maj:any', label: 'C maj', accuracy: 0 },
    ])
  })

  it('surfaces pre-seeded (persisted) stats before anything is played', () => {
    // Simulates a reload: the stats source already holds yesterday's misses
    // (Milestone B — the persisted implementation is tested in storage/).
    const stats = new InMemoryComboStats()
    stats.record('0:maj:any', 'missed', 4000)
    stats.record('0:maj:any', 'first-try', 1000)

    const s = setup({ presets: onePreset, stats })
    expect(s.store.getState().worstChords).toEqual([
      { key: '0:maj:any', label: 'C maj', accuracy: 0.5 },
    ])
  })

  it('scopes worst chords to the active preset and includes voicing labels', () => {
    const stats = new InMemoryComboStats()
    stats.record('0:maj:first-inversion', 'missed', 4000)
    stats.record('5:min7:any', 'missed', 4000) // not in this preset

    const inversions = presetsOf(
      { kind: 'explicit', chords: [{ root: 0, typeId: 'maj' }] },
      ['first-inversion'],
    )
    const s = setup({ presets: inversions, stats })
    expect(s.store.getState().worstChords).toEqual([
      {
        key: '0:maj:first-inversion',
        label: 'C maj — 1st Inversion',
        accuracy: 0,
      },
    ])
  })
})

describe('practiceStore — preset selection (§4)', () => {
  it('defaults to the first preset and exposes the built-ins', () => {
    const { store } = setup()
    expect(store.getState().presetId).toBe('major-triads')
    expect(store.getState().presets.map((p) => p.id)).toContain('diatonic')
  })

  it('restores a remembered selection', () => {
    const { store } = setup({
      memory: memoryStub({ presetId: 'seventh-chords', diatonicKey: 4 }),
    })
    expect(store.getState().presetId).toBe('seventh-chords')
    expect(store.getState().diatonicKey).toBe(4)
  })

  it('falls back to the first preset for junk memory', () => {
    const { store } = setup({
      memory: memoryStub({ presetId: 'nope', diatonicKey: 99 }),
    })
    expect(store.getState().presetId).toBe('major-triads')
    expect(store.getState().diatonicKey).toBe(0)
  })

  it('switching presets swaps the pool and shows a new prompt immediately', () => {
    const memory = memoryStub()
    const { store } = setup({ memory })
    store.getState().setPreset('seventh-chords')

    expect(store.getState().presetId).toBe('seventh-chords')
    const prompt = store.getState().prompt!
    expect(['maj7', 'min7', 'dom7']).toContain(prompt.chord.type.id)
    expect(store.getState().phase).toBe('armed')
    expect(memory.saved).toContainEqual({
      presetId: 'seventh-chords',
      diatonicKey: 0,
    })
  })

  it('ignores unknown preset ids', () => {
    const { store } = setup()
    const prompt = store.getState().prompt
    store.getState().setPreset('not-a-preset')
    expect(store.getState().presetId).toBe('major-triads')
    expect(store.getState().prompt).toBe(prompt)
  })

  it('a completed prompt awaiting auto-advance still counts when switching', () => {
    const stats = new InMemoryComboStats()
    const s = setup({ stats })
    const prompt = s.store.getState().prompt!
    s.press(...correctNotes(prompt))
    expect(s.store.getState().phase).toBe('advancing')

    s.store.getState().setPreset('minor-triads')
    expect(stats.recentHistory(promptComboKey(prompt))).toEqual({
      misses: 0,
      total: 1,
    })
    // The dead advance timer must not fire a second advance later.
    const next = s.store.getState().prompt
    vi.advanceTimersByTime(ADVANCE)
    expect(s.store.getState().prompt).toBe(next)
  })

  it('the diatonic preset drills the chosen key with key spelling', () => {
    const { store } = setup()
    store.getState().setPreset('diatonic')
    store.getState().setDiatonicKey(11) // B major

    const scalePcs = new Set([11, 1, 3, 4, 6, 8, 10])
    for (let i = 0; i < 10; i++) {
      const prompt = store.getState().prompt!
      expect(scalePcs.has(prompt.chord.root)).toBe(true)
      // Key spelling, e.g. D♯ min — never the default policy's E♭.
      expect(prompt.displayName).not.toContain('♭')
      store.getState().skip()
    }
  })

  it('changing the key while on the diatonic preset regenerates', () => {
    const { store } = setup()
    store.getState().setPreset('diatonic')
    store.getState().setDiatonicKey(7) // G major
    const gMajorPcs = new Set([7, 9, 11, 0, 2, 4, 6])
    expect(gMajorPcs.has(store.getState().prompt!.chord.root)).toBe(true)
    expect(store.getState().diatonicKey).toBe(7)
  })
})

describe('practiceStore — Learn mode (§7)', () => {
  const onePreset = presetsOf({
    kind: 'explicit',
    chords: [{ root: 0, typeId: 'maj' }],
  })

  it('completed prompts feed neither stats nor session tallies', () => {
    const stats = new InMemoryComboStats()
    const s = setup({ presets: onePreset, stats })
    s.store.getState().setMode('learn')

    const prompt = s.store.getState().prompt!
    s.press(61, 62, 63) // even a miss…
    s.releaseAll()
    playCorrectAndAdvance(s, prompt) // …then correct

    expect(stats.get('0:maj:any')).toBeNull()
    expect(s.store.getState().session.prompts).toBe(0)
    expect(s.store.getState().worstChords).toEqual([])
    expect(s.store.getState().prompt).not.toBe(prompt) // still advances
  })

  it('a pending ✔ earned in Practice still counts when switching to Learn', () => {
    const stats = new InMemoryComboStats()
    const s = setup({ presets: onePreset, stats })
    s.press(...correctNotes(s.store.getState().prompt!))
    expect(s.store.getState().phase).toBe('advancing')

    s.store.getState().setMode('learn')
    expect(stats.get('0:maj:any')?.attempts).toBe(1)
  })

  it('a pending ✔ earned in Learn is dropped when switching to Practice', () => {
    const stats = new InMemoryComboStats()
    const s = setup({ presets: onePreset, stats })
    s.store.getState().setMode('learn')
    s.releaseAll()
    s.press(...correctNotes(s.store.getState().prompt!))
    expect(s.store.getState().phase).toBe('advancing')

    s.store.getState().setMode('practice')
    expect(stats.get('0:maj:any')).toBeNull()
    expect(s.store.getState().session.prompts).toBe(0)
  })

  it('switching modes deals a fresh prompt', () => {
    const s = setup()
    const before = s.store.getState().prompt
    s.store.getState().setMode('learn')
    expect(s.store.getState().prompt).not.toBe(before)
    expect(s.store.getState().mode).toBe('learn')
  })

  it('switching to Learn cancels a running timer without a summary', () => {
    const s = setup()
    s.store.getState().startTimer(5)
    expect(s.store.getState().timerEndsAt).not.toBeNull()

    s.store.getState().setMode('learn')
    expect(s.store.getState().timerEndsAt).toBeNull()
    expect(s.store.getState().timerMinutes).toBeNull()
    vi.advanceTimersByTime(5 * 60_000)
    expect(s.store.getState().summary).toBeNull() // dead timer never fires
  })

  it('starting a timer in Learn mode is a no-op (Learn is untimed)', () => {
    const s = setup()
    s.store.getState().setMode('learn')
    s.store.getState().startTimer(5)
    expect(s.store.getState().timerEndsAt).toBeNull()
  })
})

describe('practiceStore — worst chords only (§5/§7)', () => {
  const sixRoots = presetsOf({
    kind: 'product',
    roots: [0, 1, 2, 3, 4, 5],
    chordTypes: ['maj'],
  })

  it('draws only from the preset combos missed somewhere', () => {
    const stats = new InMemoryComboStats()
    stats.record('0:maj:any', 'missed', 4000)
    stats.record('3:maj:any', 'missed', 4000)
    stats.record('1:maj:any', 'first-try', 1000) // clean — never drawn

    const s = setup({ presets: sixRoots, stats })
    s.store.getState().setWorstOnly(true)
    for (let i = 0; i < 20; i++) {
      expect([0, 3]).toContain(s.store.getState().prompt!.chord.root)
      s.store.getState().skip()
    }
  })

  it('falls back to the whole pool while nothing qualifies', () => {
    const s = setup({ presets: sixRoots })
    s.store.getState().setWorstOnly(true)
    expect(s.store.getState().prompt).not.toBeNull()
    expect(s.store.getState().worstOnly).toBe(true)
  })

  it('Learn mode ignores the toggle', () => {
    const stats = new InMemoryComboStats()
    stats.record('0:maj:any', 'missed', 4000)
    const s = setup({ presets: sixRoots, stats })
    s.store.getState().setWorstOnly(true)
    s.store.getState().setMode('learn')

    const seen = new Set<number>()
    for (let i = 0; i < 30; i++) {
      seen.add(s.store.getState().prompt!.chord.root)
      s.store.getState().skip()
    }
    expect(seen.size).toBeGreaterThan(1) // not pinned to the one missed combo
  })
})

describe('practiceStore — session timer & summary (§7)', () => {
  const onePreset = presetsOf({
    kind: 'explicit',
    chords: [{ root: 0, typeId: 'maj' }],
  })

  it('starting a timer begins a fresh session', () => {
    const s = setup({ presets: onePreset })
    playCorrectAndAdvance(s, s.store.getState().prompt!)
    expect(s.store.getState().session.prompts).toBe(1)

    s.store.getState().startTimer(5)
    expect(s.store.getState().session.prompts).toBe(0)
    expect(s.store.getState().timerMinutes).toBe(5)
    expect(s.store.getState().timerEndsAt).toBe(Date.now() + 5 * 60_000)
  })

  it('presents a summary of the timed window when time runs out', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().startTimer(5)

    vi.advanceTimersByTime(1000)
    playCorrectAndAdvance(s, s.store.getState().prompt!) // first-try, 1000 ms
    const second = s.store.getState().prompt!
    s.press(61, 62, 63) // miss…
    s.releaseAll()
    playCorrectAndAdvance(s, second) // …corrected

    vi.advanceTimersByTime(5 * 60_000)
    const state = s.store.getState()
    expect(state.summary).toMatchObject({
      prompts: 2,
      firstTrySuccesses: 1,
    })
    expect(state.summary!.worst.map((e) => e.key)).toEqual(['0:maj:any'])
    expect(state.summary!.slowest).toHaveLength(1)
    expect(state.prompt).toBeNull()
    expect(state.phase).toBe('idle')
    expect(state.timerMinutes).toBeNull()
  })

  it('a ✔ still waiting out its advance window counts at expiry', () => {
    const stats = new InMemoryComboStats()
    const s = setup({ presets: onePreset, stats })
    s.store.getState().startTimer(1)

    vi.advanceTimersByTime(59_900)
    s.press(...correctNotes(s.store.getState().prompt!))
    expect(s.store.getState().phase).toBe('advancing')

    vi.advanceTimersByTime(100) // timer fires before the advance window ends
    expect(s.store.getState().summary!.prompts).toBe(1)
    expect(stats.get('0:maj:any')?.attempts).toBe(1)
    // The dead advance timer must not deal a prompt over the summary.
    vi.advanceTimersByTime(ADVANCE)
    expect(s.store.getState().prompt).toBeNull()
    s.releaseAll()
  })

  it('input is ignored while the summary is open', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().startTimer(1)
    vi.advanceTimersByTime(60_000)
    expect(s.store.getState().summary).not.toBeNull()

    s.press(60, 64, 67)
    expect(s.store.getState().phase).toBe('idle')
    s.store.getState().skip()
    expect(s.store.getState().prompt).toBeNull()
    s.releaseAll()
  })

  it('dismissing the summary resumes endless practice as a fresh session', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().startTimer(1)
    playCorrectAndAdvance(s, s.store.getState().prompt!)
    vi.advanceTimersByTime(60_000)

    s.store.getState().dismissSummary()
    const state = s.store.getState()
    expect(state.summary).toBeNull()
    expect(state.prompt).not.toBeNull()
    expect(state.phase).toBe('armed')
    expect(state.session.prompts).toBe(0)
    expect(state.timerEndsAt).toBeNull()
  })

  it('cancelling the timer returns to endless with no summary', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().startTimer(5)
    playCorrectAndAdvance(s, s.store.getState().prompt!)

    s.store.getState().cancelTimer()
    expect(s.store.getState().timerEndsAt).toBeNull()
    expect(s.store.getState().session.prompts).toBe(1) // session continues

    vi.advanceTimersByTime(5 * 60_000)
    expect(s.store.getState().summary).toBeNull()
  })

  it('rejects junk durations', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().startTimer(0)
    s.store.getState().startTimer(-5)
    s.store.getState().startTimer(NaN)
    expect(s.store.getState().timerEndsAt).toBeNull()
  })
})

describe('practiceStore — active minutes & goal (§7)', () => {
  it('accrues active time from held-note events into the daily record', () => {
    const activity = new InMemoryDailyActivity()
    const s = setup({ activity })

    s.press(60) // first event — nothing credited yet
    vi.advanceTimersByTime(3000)
    s.release(60) // +3 s buffered (below the 5 s flush threshold)
    expect(activity.todayMinutes()).toBe(0)

    vi.advanceTimersByTime(3000)
    s.press(62) // +3 s → 6 s ≥ threshold → flushed
    expect(activity.todayMinutes()).toBeCloseTo(0.1, 5)
    expect(s.store.getState().goal.todayMinutes).toBeCloseTo(0.1, 5)
    s.releaseAll()
  })

  it('gaps longer than the idle window earn nothing', () => {
    const activity = new InMemoryDailyActivity()
    const s = setup({ activity })

    s.press(60)
    vi.advanceTimersByTime(31_000) // walked away
    s.release(60)
    vi.advanceTimersByTime(6000)
    s.press(60)
    expect(activity.todayMinutes()).toBeCloseTo(0.1, 5) // only the 6 s counted
    s.releaseAll()
  })

  it('Learn mode still accrues active time (§5)', () => {
    const activity = new InMemoryDailyActivity()
    const s = setup({ activity })
    s.store.getState().setMode('learn')

    s.press(60)
    vi.advanceTimersByTime(6000)
    s.release(60)
    expect(activity.todayMinutes()).toBeCloseTo(0.1, 5)
  })

  it('exposes persisted goal progress and streak at startup', () => {
    const activity = new InMemoryDailyActivity()
    activity.addMinutes(12) // ≥ the default 10-minute goal
    const s = setup({ activity })
    expect(s.store.getState().goal).toEqual({ todayMinutes: 12, streak: 1 })
  })
})

describe('practiceStore — pause/resume (Phase 7 History nav)', () => {
  const onePreset = presetsOf({
    kind: 'explicit',
    chords: [{ root: 0, typeId: 'maj' }],
  })

  it('pause drops the prompt and start deals a fresh one', () => {
    const s = setup()
    expect(s.store.getState().prompt).not.toBeNull()
    s.store.getState().pause()
    expect(s.store.getState().prompt).toBeNull()
    expect(s.store.getState().phase).toBe('idle')

    s.store.getState().start()
    expect(s.store.getState().prompt).not.toBeNull()
    expect(s.store.getState().phase).toBe('armed')
  })

  it('a ✔ waiting out its advance window still counts when pausing', () => {
    const stats = new InMemoryComboStats()
    const s = setup({ presets: onePreset, stats })
    s.press(...correctNotes(s.store.getState().prompt!))

    s.store.getState().pause()
    expect(stats.get('0:maj:any')?.attempts).toBe(1)
    vi.advanceTimersByTime(ADVANCE) // dead advance timer must not re-prompt
    expect(s.store.getState().prompt).toBeNull()
    s.releaseAll()
  })

  it('start never deals a prompt over an open summary', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().startTimer(1)
    vi.advanceTimersByTime(60_000)
    expect(s.store.getState().summary).not.toBeNull()

    s.store.getState().start()
    expect(s.store.getState().prompt).toBeNull()
  })
})

describe('practiceStore — custom library (Phase 9)', () => {
  const wideRoot: VoicingRule = {
    id: 'rule-wide',
    name: 'Wide Root',
    bass: { kind: 'chordTone', degree: 0 },
    span: { min: 12 },
    doubling: 'exact',
  }
  const customPreset: Preset = {
    id: 'preset-custom',
    name: 'Custom drill',
    pool: { kind: 'product', roots: [0], chordTypes: ['maj'] },
    voicingIds: ['rule-wide'],
  }
  const builtInLike: Preset = {
    id: 'first',
    name: 'First',
    pool: { kind: 'explicit', chords: [{ root: 0, typeId: 'maj' }] },
    voicingIds: ['any'],
  }

  it('drills a custom preset against its custom rule', () => {
    const s = setup({
      presets: () => [customPreset],
      voicings: () => voicingLibrary([wideRoot]),
    })
    const prompt = s.store.getState().prompt!
    expect(prompt.voicing).toEqual(wideRoot)
    // The compact voicing violates the span-min-12 rule; the example is a
    // rule-satisfying voicing by construction.
    s.press(...correctNotes(prompt))
    expect(s.store.getState().phase).not.toBe('advancing')
    s.releaseAll()
    s.press(...prompt.example)
    expect(s.store.getState().phase).toBe('advancing')
  })

  it('falls back to the first preset when the active one disappears', () => {
    let list = [builtInLike, customPreset]
    const memory = memoryStub({ presetId: 'preset-custom', diatonicKey: 0 })
    const s = setup({
      presets: () => list,
      voicings: () => voicingLibrary([wideRoot]),
      memory,
    })
    expect(s.store.getState().presetId).toBe('preset-custom')

    list = [builtInLike] // the custom preset was deleted
    s.store.getState().refreshLibrary()
    expect(s.store.getState().presetId).toBe('first')
    expect(s.store.getState().prompt?.voicing.id).toBe('any')
    expect(memory.saved.at(-1)).toEqual({ presetId: 'first', diatonicKey: 0 })
  })

  it('falls back when rule edits leave the active preset empty', () => {
    let rules = [wideRoot]
    const s = setup({
      presets: () => [builtInLike, customPreset],
      voicings: () => voicingLibrary(rules),
      memory: memoryStub({ presetId: 'preset-custom', diatonicKey: 0 }),
    })
    expect(s.store.getState().presetId).toBe('preset-custom')

    // The rule now demands a chord tone triads don't have — every combo of
    // the custom preset becomes unsatisfiable.
    rules = [{ ...wideRoot, bass: { kind: 'chordTone', degree: 3 } }]
    s.store.getState().refreshLibrary()
    expect(s.store.getState().presetId).toBe('first')
  })

  it('refreshLibrary while paused re-resolves without dealing a prompt', () => {
    const s = setup({
      presets: () => [builtInLike],
      voicings: () => voicingLibrary([]),
    })
    s.store.getState().pause()
    s.store.getState().refreshLibrary()
    expect(s.store.getState().prompt).toBeNull()
    expect(s.store.getState().phase).toBe('idle')
  })
})

describe('practiceStore — Song mode (§6.5)', () => {
  const BEAT = 60_000 / DEFAULT_PRACTICE_SETTINGS.songTempoBpm
  const BAR = BEAT * 4

  // A diatonic preset that follows the key picker, like the built-in one.
  const diatonicPresets = (key: PitchClass): readonly Preset[] => [
    {
      id: 'test-diatonic',
      name: 'Test diatonic',
      pool: { kind: 'diatonic', key },
      voicingIds: ['any'],
    },
  ]

  // rng () => 0 with the diatonic preset in C major picks the lowest
  // remaining degrees: I ii iii IV = C, Dm, Em, F.
  const enterSong = (deps: Parameters<typeof createPracticeStore>[0] = {}) => {
    const s = setup({ rng: () => 0, presets: diatonicPresets, ...deps })
    s.store.getState().setMode('song')
    return s
  }

  it('entering Song counts in with progression chips; the machine stays dead', () => {
    const s = enterSong()
    const state = s.store.getState()
    expect(state.song?.countingIn).toBe(true)
    expect(state.upcoming).toEqual([])
    expect(state.prompt?.displayName).toBe('C maj')
    expect(state.songChords.map((c) => c.label)).toEqual(['C', 'Dm', 'Em', 'F'])
    expect(state.songChords.map((c) => c.roman)).toEqual([
      'I',
      'ii',
      'iii',
      'IV',
    ])

    // Correct notes during the count-in: no §6.2 judging, no marking.
    s.press(60, 64, 67)
    expect(s.store.getState().phase).toBe('idle')
    expect(s.store.getState().song?.hitCount).toBe(0)
    expect(s.store.getState().hint).toBeNull()
    s.releaseAll()
  })

  it('records hits and misses per bar with no time sample or session tally', () => {
    const stats = new InMemoryComboStats()
    const s = enterSong({ stats })
    s.press(60, 64, 67) // hold C maj through the count-in (legato)
    vi.advanceTimersByTime(BAR) // bar 0 starts and judges the held set
    expect(s.store.getState().song?.hitCount).toBe(1)
    expect(stats.get('0:maj:any')).toBeNull() // stamped only at bar end

    vi.advanceTimersByTime(BAR) // bar 0 completes, bar 1 (Dm) starts
    expect(stats.get('0:maj:any')).toEqual({
      attempts: 1,
      firstTrySuccesses: 1,
      recentOutcomes: ['first-try'],
      timeToCorrectMs: [],
    })

    s.releaseAll()
    vi.advanceTimersByTime(BAR) // bar 1 untouched → miss
    expect(stats.get('2:min:any')?.recentOutcomes).toEqual(['missed'])
    expect(s.store.getState().session.prompts).toBe(0) // stats bar untouched
  })

  it('marks foreign held keys without ever escalating', () => {
    const s = enterSong()
    vi.advanceTimersByTime(BAR) // bar 0 (C maj) live
    s.press(61)
    expect(s.store.getState().hint).toEqual({ kind: 'wrong-keys', notes: [61] })
    expect(s.store.getState().missCount).toBe(0)
    s.releaseAll()
    expect(s.store.getState().hint).toBeNull()
  })

  it('re-evaluates the wrong-key mark when the bar turns over', () => {
    const s = enterSong()
    vi.advanceTimersByTime(BAR)
    s.press(62) // D: foreign to C maj…
    expect(s.store.getState().hint).toEqual({ kind: 'wrong-keys', notes: [62] })
    vi.advanceTimersByTime(BAR) // …but a chord tone of bar 1's D minor
    expect(s.store.getState().hint).toBeNull()
    s.releaseAll()
  })

  it('setDiatonicKey rebuilds at the new key with a fresh count-in', () => {
    const memory = memoryStub()
    const s = enterSong({ memory })
    vi.advanceTimersByTime(BAR + BEAT) // one beat into bar 0
    s.store.getState().setDiatonicKey(7)
    const state = s.store.getState()
    expect(state.song?.countingIn).toBe(true)
    expect(state.prompt?.displayName).toBe('G maj')
    expect(state.songChords.map((c) => c.label)).toEqual(['G', 'Am', 'Bm', 'C'])
    expect(memory.saved.at(-1)).toMatchObject({ diatonicKey: 7 })
  })

  it('draws the progression from a non-diatonic preset, without numerals', () => {
    // The default built-ins: 'major-triads' (all 12 roots × maj) is first.
    const s = setup({ rng: () => 0 })
    s.store.getState().setMode('song')
    const state = s.store.getState()
    expect(state.presetId).toBe('major-triads')
    expect(state.songChords.map((c) => c.label)).toEqual(['C', 'C♯', 'D', 'E♭'])
    expect(state.songChords.map((c) => c.roman)).toEqual(['', '', '', ''])
    expect(state.prompt?.displayName).toBe('C maj')
  })

  it('setPreset mid-song rebuilds from the new pool with a fresh count-in', () => {
    const s = setup({ rng: () => 0 })
    s.store.getState().setMode('song')
    vi.advanceTimersByTime(BAR + BEAT) // a bar in flight
    s.store.getState().setPreset('minor-triads')
    const state = s.store.getState()
    expect(state.presetId).toBe('minor-triads')
    expect(state.song?.countingIn).toBe(true)
    expect(state.songChords.map((c) => c.label)).toEqual([
      'Cm',
      'C♯m',
      'Dm',
      'E♭m',
    ])
  })

  it('leaving Song stops the clock and resumes self-paced practice', () => {
    const stats = new InMemoryComboStats()
    const s = enterSong({ stats })
    vi.advanceTimersByTime(BAR + BEAT) // a bar in flight
    s.store.getState().setMode('practice')
    const state = s.store.getState()
    expect(state.song).toBeNull()
    expect(state.songChords).toEqual([])
    expect(state.prompt).not.toBeNull()
    expect(state.phase).toBe('armed')

    // Dead clock: the abandoned bar recorded nothing, and time passing
    // records nothing more.
    vi.advanceTimersByTime(BAR * 10)
    expect(stats.get('0:maj:any')).toBeNull()
  })

  it('pause halts the song; start counts a fresh progression back in', () => {
    const s = enterSong()
    vi.advanceTimersByTime(BAR + BEAT)
    s.store.getState().pause()
    expect(s.store.getState().prompt).toBeNull()
    expect(s.store.getState().song).toBeNull()
    vi.advanceTimersByTime(BAR * 5) // silent while paused

    s.store.getState().start()
    expect(s.store.getState().mode).toBe('song')
    expect(s.store.getState().song?.countingIn).toBe(true)
  })

  it('skip is inert in Song', () => {
    const s = enterSong()
    vi.advanceTimersByTime(BAR)
    const before = s.store.getState().song
    s.store.getState().skip()
    expect(s.store.getState().song).toBe(before)
    expect(s.store.getState().prompt?.displayName).toBe('C maj')
  })

  it('active minutes accrue from Song-mode playing', () => {
    const activity = new InMemoryDailyActivity()
    const s = enterSong({ activity })
    s.press(60)
    vi.advanceTimersByTime(6000)
    s.press(62)
    expect(activity.todayMinutes()).toBeCloseTo(0.1, 5)
    s.releaseAll()
  })
})
