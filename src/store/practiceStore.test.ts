import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chordPitchClasses, type PitchClass } from '../theory'
import {
  comboKey,
  DEFAULT_PRACTICE_SETTINGS,
  InMemoryRecentStats,
  type ChordPool,
  type Preset,
  type Prompt,
} from '../practice'
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

describe('practiceStore — outcome recording (§5/§7)', () => {
  const onePreset = presetsOf({
    kind: 'explicit',
    chords: [{ root: 0, typeId: 'maj' }],
  })

  it('records a first-try success', () => {
    const stats = new InMemoryRecentStats()
    const s = setup({ presets: onePreset, stats })
    const prompt = s.store.getState().prompt!
    playCorrectAndAdvance(s, prompt)
    expect(stats.recentHistory(promptComboKey(prompt))).toEqual({
      misses: 0,
      total: 1,
    })
  })

  it('records a missed-then-corrected prompt as a miss', () => {
    const stats = new InMemoryRecentStats()
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
    const stats = new InMemoryRecentStats()
    const s = setup({ presets: onePreset, stats })
    const prompt = s.store.getState().prompt!

    s.press(61, 62, 63)
    s.releaseAll()
    s.store.getState().skip()

    expect(stats.recentHistory(promptComboKey(prompt))).toBeNull()
  })

  it('shows the 🔥 indicator when a recently-missed combo comes up again', () => {
    const stats = new InMemoryRecentStats()
    const s = setup({ presets: onePreset, stats })
    const prompt = s.store.getState().prompt!
    expect(s.store.getState().missedRecently).toBeNull()

    s.press(61, 62, 63)
    s.releaseAll()
    playCorrectAndAdvance(s, prompt)

    // Same (only) combo again — now flagged as recently missed.
    expect(s.store.getState().missedRecently).toBe(1)
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
    const stats = new InMemoryRecentStats()
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
