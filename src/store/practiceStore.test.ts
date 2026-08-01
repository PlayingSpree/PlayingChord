import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chordPitchClasses,
  voicingLibrary,
  type PitchClass,
  type VoicingRule,
} from '../theory'
import {
  comboGrade,
  comboKey,
  comboMetrics,
  DEFAULT_PRACTICE_SETTINGS,
  GRADE_TIME_MS,
  RECENT_OUTCOME_WINDOW,
  INITIAL_UNLOCK_COUNT,
  InMemoryComboStats,
  MAX_TIME_TO_CORRECT_MS,
  UNLOCK_BATCH_SIZE,
  type ChordPool,
  type Preset,
  type Prompt,
} from '../practice'
import {
  InMemoryBestStreak,
  InMemoryDailyActivity,
  InMemoryPresetProgress,
} from '../storage'
import {
  createPracticeStore,
  JUST_UNLOCKED_FLASH_MS,
  type PresetMemory,
} from './practiceStore'

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

// A progress source with the given preset already fully unlocked, for tests
// about generation across a whole pool (the §5 gating is tested separately).
function fullyUnlocked(
  presetId: string,
  chordCount: number,
): InMemoryPresetProgress {
  const progress = new InMemoryPresetProgress()
  progress.set(presetId, {
    unlockedCount: chordCount,
    masteredIndices: [],
    setAsideIndices: [],
  })
  return progress
}

// A one-chord preset already unlocked *and* passed (§5.1), so the not-yet-
// passed half of the worst-only pool is empty and only a miss on the record
// can fill it.
function allPassed(presetId: string): InMemoryPresetProgress {
  const progress = new InMemoryPresetProgress()
  progress.set(presetId, {
    unlockedCount: 1,
    masteredIndices: [0],
    setAsideIndices: [],
  })
  return progress
}

// `autoStart` mirrors the Stage mounting (§7.2). Pass false for the Home
// state the app actually boots into — a store with no session running, where
// the mode/preset pickers are pure config.
function setup(
  deps: Parameters<typeof createPracticeStore>[0] = {},
  autoStart = true,
) {
  const store = createPracticeStore({
    settings: () => DEFAULT_PRACTICE_SETTINGS, // independent of localStorage
    memory: memoryStub(),
    stats: new InMemoryComboStats(), // never the shared appStorage singleton
    activity: new InMemoryDailyActivity(),
    progress: new InMemoryPresetProgress(),
    bestStreak: new InMemoryBestStreak(),
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
  if (autoStart) {
    store.getState().start()
    // Answer the §7.3 ready gate the way the Stage's panel (or any note) does,
    // so these tests see the prompt the Stage shows once the player is set.
    // A no-op in Learn/Song, which don't gate.
    store.getState().ready()
    // Default to ∞ so length-agnostic tests can drill as many prompts as they
    // like; the session-length suite sets its own length explicitly.
    store.getState().setSessionLength({ unit: 'prompts', value: null })
  }
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

// The Stage mounting over a session (§7.2) with the §7.3 ready gate answered —
// what autoStart does, for the tests that drive start() themselves.
const enterStage = (s: ReturnType<typeof setup>) => {
  s.store.getState().start()
  s.store.getState().ready()
}

const playCorrectAndAdvance = (s: ReturnType<typeof setup>, prompt: Prompt) => {
  s.press(...correctNotes(prompt))
  s.releaseAll()
  vi.advanceTimersByTime(ADVANCE)
}

// Advance past a prompt without moving the §5.1 unlock queue: a clean rep
// slower than D's second grades F on speed alone, so it can never pass a
// chord. Generation tests use it to cycle prompts over a fixed pool.
const playSlowAndAdvance = (s: ReturnType<typeof setup>, prompt: Prompt) => {
  vi.advanceTimersByTime(6000) // past D's second (§7.5)
  playCorrectAndAdvance(s, prompt)
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

describe('practiceStore — generation', () => {
  it('never repeats a prompt within the recent window', () => {
    const presets = presetsOf({
      kind: 'product',
      roots: [0, 1, 2, 3, 4, 5],
      chordTypes: ['maj'],
    })
    const s = setup({ presets, progress: fullyUnlocked('test', 6) })
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
    const s = setup({
      presets: bigPreset,
      progress: fullyUnlocked('test', 6),
    })
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
    // Roots 1 and 2 passed, so the worst-only pool really is the one combo —
    // not-yet-passed chords would otherwise join it (§7.3).
    const progress = new InMemoryPresetProgress()
    progress.set('test', {
      unlockedCount: 3,
      masteredIndices: [1, 2],
      setAsideIndices: [],
    })
    const s = setup({ presets: explicit, stats, progress })

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
      avgTimeToCorrectMs: 0,
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
      avgTimeToCorrectMs: 0,
    })
  })

  it('caps a walked-away-from prompt at the time-to-correct ceiling', () => {
    const stats = new InMemoryComboStats()
    const s = setup({ presets: onePreset, stats })
    const prompt = s.store.getState().prompt!

    vi.advanceTimersByTime(90_000) // left the keyboard mid-session
    playCorrectAndAdvance(s, prompt)

    expect(stats.get(promptComboKey(prompt))?.timeToCorrectMs).toEqual([
      MAX_TIME_TO_CORRECT_MS,
    ])
    // The session average and the Report log see the same capped value.
    expect(s.store.getState().session.totalTimeToCorrectMs).toBe(
      MAX_TIME_TO_CORRECT_MS,
    )
  })

  it('leaves a time under the ceiling alone, and it is still first-try', () => {
    const stats = new InMemoryComboStats()
    const s = setup({ presets: onePreset, stats })
    const prompt = s.store.getState().prompt!

    vi.advanceTimersByTime(MAX_TIME_TO_CORRECT_MS - 1)
    playCorrectAndAdvance(s, prompt)

    expect(stats.get(promptComboKey(prompt))?.timeToCorrectMs).toEqual([
      MAX_TIME_TO_CORRECT_MS - 1,
    ])
    expect(stats.recentHistory(promptComboKey(prompt))?.misses).toBe(0)
    expect(s.store.getState().firstTryStreak).toBe(1)
  })

  it('grades a rep that reaches the ceiling as a miss, and only grades it', () => {
    const stats = new InMemoryComboStats()
    const s = setup({ presets: onePreset, stats })

    playCorrectAndAdvance(s, s.store.getState().prompt!) // a clean rep first
    const prompt = s.store.getState().prompt!
    vi.advanceTimersByTime(MAX_TIME_TO_CORRECT_MS) // …then one that stalls out
    playCorrectAndAdvance(s, prompt)

    // The grade window sees a miss (§6.2)…
    expect(stats.recentHistory(promptComboKey(prompt))).toEqual({
      misses: 1,
      total: 2,
      avgTimeToCorrectMs: MAX_TIME_TO_CORRECT_MS / 2,
    })
    // …while everything that reports what was played still counts both reps
    // as answered first try: lifetime accuracy, the session tallies, the
    // Report log and the §7.3 streak.
    expect(stats.get(promptComboKey(prompt))?.firstTrySuccesses).toBe(2)
    expect(s.store.getState().session.firstTrySuccesses).toBe(2)
    expect(s.store.getState().firstTryStreak).toBe(2)
  })
})

describe('practiceStore — unlock progress (§5)', () => {
  const sixRoots = presetsOf({
    kind: 'product',
    roots: [0, 1, 2, 3, 4, 5],
    chordTypes: ['maj'],
  })

  it('starts a fresh preset with the initial chords unlocked', () => {
    const s = setup({ presets: sixRoots })
    expect(s.store.getState().progress).toEqual({
      unlocked: INITIAL_UNLOCK_COUNT,
      passed: 0,
      total: 6,
      setAside: 0,
    })
    expect(s.store.getState().justUnlocked).toBe(false)
  })

  it('draws prompts and previews only from unlocked chords', () => {
    const s = setup({ presets: sixRoots })
    const unlockedRoots = [0, 1, 2] // pool order: chromatic roots
    for (let i = 0; i < 30; i++) {
      expect(unlockedRoots).toContain(s.store.getState().prompt!.chord.root)
      s.store.getState().upcoming.forEach((u) => {
        expect(unlockedRoots).toContain(Number(u.key.split(':')[0]))
      })
      playSlowAndAdvance(s, s.store.getState().prompt!) // never passes
    }
    expect(s.store.getState().progress.unlocked).toBe(INITIAL_UNLOCK_COUNT)
  })

  it('passing every unlocked chord unlocks the next batch', () => {
    const progress = new InMemoryPresetProgress()
    const s = setup({ presets: sixRoots, progress })

    // Every prompt is a fast first-try; the three unlocked chords are all
    // passed within a handful of prompts.
    let advances = 0
    while (
      s.store.getState().progress.unlocked === INITIAL_UNLOCK_COUNT &&
      advances < 10
    ) {
      playCorrectAndAdvance(s, s.store.getState().prompt!)
      advances++
    }

    expect(s.store.getState().progress).toEqual({
      unlocked: INITIAL_UNLOCK_COUNT + UNLOCK_BATCH_SIZE,
      passed: INITIAL_UNLOCK_COUNT,
      total: 6,
      setAside: 0,
    })
    expect(s.store.getState().justUnlocked).toBe(true)
    expect(progress.get('test')?.unlockedCount).toBe(
      INITIAL_UNLOCK_COUNT + UNLOCK_BATCH_SIZE,
    )

    vi.advanceTimersByTime(JUST_UNLOCKED_FLASH_MS)
    expect(s.store.getState().justUnlocked).toBe(false)
  })

  it('unlocking publishes the new chords’ labels for the toast', () => {
    const s = setup({ presets: sixRoots })
    expect(s.store.getState().justUnlockedLabels).toEqual([])

    let advances = 0
    while (!s.store.getState().justUnlocked && advances < 10) {
      playCorrectAndAdvance(s, s.store.getState().prompt!)
      advances++
    }

    // The batch after roots 0–2 is roots 3 and 4: E♭ and E major.
    expect(s.store.getState().justUnlockedLabels).toEqual(['E♭', 'E'])
    vi.advanceTimersByTime(JUST_UNLOCKED_FLASH_MS)
    expect(s.store.getState().justUnlockedLabels).toEqual([])
  })

  it('unlockByFifths reorders a product pool’s unlock order (§5.1)', () => {
    const s = setup({
      presets: sixRoots,
      settings: () => ({ ...DEFAULT_PRACTICE_SETTINGS, unlockByFifths: true }),
    })
    // Fifths positions of roots 0–5 are C=0, D=2, E=4 ahead of C♯=7,
    // E♭=9, F=11 — so the first unlocked three are 0, 2, 4.
    for (let i = 0; i < 20; i++) {
      expect([0, 2, 4]).toContain(s.store.getState().prompt!.chord.root)
      playSlowAndAdvance(s, s.store.getState().prompt!)
    }
  })

  it('unlockByFifths leaves a diatonic pool in scale-degree order', () => {
    const s = setup({
      presets: presetsOf({ kind: 'diatonic', key: 7 }), // G major
      settings: () => ({ ...DEFAULT_PRACTICE_SETTINGS, unlockByFifths: true }),
    })
    // Still the first three scale degrees — G, Am, Bm — not a fifths sort
    // of the diatonic roots (which would surface C first).
    for (let i = 0; i < 20; i++) {
      expect([7, 9, 11]).toContain(s.store.getState().prompt!.chord.root)
      playSlowAndAdvance(s, s.store.getState().prompt!)
    }
  })

  it('refreshUnlockOrder re-derives the order after the setting flips', () => {
    let fifths = false
    const s = setup({
      presets: sixRoots,
      settings: () => ({
        ...DEFAULT_PRACTICE_SETTINGS,
        unlockByFifths: fifths,
      }),
    })
    expect([0, 1, 2]).toContain(s.store.getState().prompt!.chord.root)

    fifths = true
    s.store.getState().refreshUnlockOrder()
    for (let i = 0; i < 20; i++) {
      expect([0, 2, 4]).toContain(s.store.getState().prompt!.chord.root)
      playSlowAndAdvance(s, s.store.getState().prompt!)
    }
  })

  it('clean but F-slow reps do not pass (§5.1)', () => {
    const s = setup({ presets: sixRoots })
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(6000) // past D's second: F on speed alone
      playCorrectAndAdvance(s, s.store.getState().prompt!)
    }
    expect(s.store.getState().progress.unlocked).toBe(INITIAL_UNLOCK_COUNT)
    expect(s.store.getState().progress.passed).toBe(0)
  })

  it('merely slow reps still pass — the bar is D, not speed (§5.1)', () => {
    const s = setup({ presets: sixRoots })
    let advances = 0
    // Slow reps clear the bar by accumulating a window rather than by being
    // quick, so this takes several reps per chord (§5 evidence floor).
    while (
      s.store.getState().progress.unlocked === INITIAL_UNLOCK_COUNT &&
      advances < 40
    ) {
      vi.advanceTimersByTime(4500) // D-paced: slow, but not failing
      playCorrectAndAdvance(s, s.store.getState().prompt!)
      advances++
    }
    expect(s.store.getState().progress.unlocked).toBe(
      INITIAL_UNLOCK_COUNT + UNLOCK_BATCH_SIZE,
    )
  })

  it('flags the rep that learns a chord, one window before it lands (§7.3)', () => {
    const s = setup({ presets: sixRoots })
    const prompt = s.store.getState().prompt!
    s.press(...correctNotes(prompt))
    s.releaseAll()

    // The pass itself is applied on advance; the flag calls it on the judgment
    // edge so the ✔ flash can say so while it's still up.
    expect(s.store.getState().phase).toBe('advancing')
    expect(s.store.getState().justLearned).toBe(true)
    expect(s.store.getState().progress.passed).toBe(0)

    vi.advanceTimersByTime(ADVANCE)
    expect(s.store.getState().progress.passed).toBe(1)
    expect(s.store.getState().justLearned).toBe(false) // the next prompt clears it
  })

  it('does not flag a failing rep, or a chord that already passed', () => {
    const oneChord = presetsOf({
      kind: 'explicit',
      chords: [{ root: 0, typeId: 'maj' }],
    })
    const s = setup({ presets: oneChord })

    vi.advanceTimersByTime(6000) // F on speed alone: not learned
    s.press(...correctNotes(s.store.getState().prompt!))
    s.releaseAll()
    expect(s.store.getState().justLearned).toBe(false)
    vi.advanceTimersByTime(ADVANCE)

    // A clean rep lifts it out of F — that one is the callout…
    s.press(...correctNotes(s.store.getState().prompt!))
    s.releaseAll()
    expect(s.store.getState().justLearned).toBe(true)
    vi.advanceTimersByTime(ADVANCE)

    // …and the next one, on the now-passed chord, says nothing.
    s.press(...correctNotes(s.store.getState().prompt!))
    s.releaseAll()
    expect(s.store.getState().justLearned).toBe(false)
  })

  it('a missed-then-corrected prompt does not pass', () => {
    const s = setup({ presets: sixRoots })
    for (let i = 0; i < 6; i++) {
      const prompt = s.store.getState().prompt!
      s.press(61, 62, 63)
      s.releaseAll()
      playCorrectAndAdvance(s, prompt)
    }
    expect(s.store.getState().progress.unlocked).toBe(INITIAL_UNLOCK_COUNT)
  })

  it('Learn mode never advances pass progress', () => {
    const s = setup({ presets: sixRoots })
    s.store.getState().setMode('learn')
    // The loop ends once its set is rehearsed (§5.4), so this stops there —
    // the point is that rehearsing every chord in it still unlocks nothing.
    for (let i = 0; i < 10 && s.store.getState().report === null; i++) {
      playCorrectAndAdvance(s, s.store.getState().prompt!)
    }
    expect(s.store.getState().progress.unlocked).toBe(INITIAL_UNLOCK_COUNT)
    expect(s.store.getState().progress.passed).toBe(0)
  })

  it('progress persists across store instances via the progress source', () => {
    const progress = new InMemoryPresetProgress()
    progress.set('test', {
      unlockedCount: 5,
      masteredIndices: [0],
      setAsideIndices: [],
    })
    const s = setup({ presets: sixRoots, progress })
    expect(s.store.getState().progress).toEqual({
      unlocked: 5,
      passed: 1,
      total: 6,
      setAside: 0,
    })
  })

  it('a stored record larger than the pool reconciles down', () => {
    const progress = new InMemoryPresetProgress()
    progress.set('test', {
      unlockedCount: 40,
      masteredIndices: [0, 20],
      setAsideIndices: [],
    })
    const s = setup({ presets: sixRoots, progress })
    expect(s.store.getState().progress).toEqual({
      unlocked: 6,
      passed: 1,
      total: 6,
      setAside: 0,
    })
    expect(progress.get('test')).toEqual({
      unlockedCount: 6,
      masteredIndices: [0],
      setAsideIndices: [],
    })
  })

  it('resetPresetProgress returns the active preset to the initial count', () => {
    const progress = fullyUnlocked('test', 6)
    const s = setup({ presets: sixRoots, progress })
    expect(s.store.getState().progress.unlocked).toBe(6)

    s.store.getState().resetPresetProgress('test')
    expect(s.store.getState().progress).toEqual({
      unlocked: INITIAL_UNLOCK_COUNT,
      passed: 0,
      total: 6,
      setAside: 0,
    })
    // The live prompt was redealt from the narrowed pool.
    expect([0, 1, 2]).toContain(s.store.getState().prompt!.chord.root)
    expect(progress.get('test')).toBeNull()
  })

  it('resetPresetProgress on an inactive preset leaves the session alone', () => {
    const progress = new InMemoryPresetProgress()
    progress.set('other', {
      unlockedCount: 9,
      masteredIndices: [],
      setAsideIndices: [],
    })
    const s = setup({ presets: sixRoots, progress })
    const prompt = s.store.getState().prompt

    s.store.getState().resetPresetProgress('other')
    expect(progress.get('other')).toBeNull()
    expect(s.store.getState().prompt).toBe(prompt)
  })

  it('a diatonic key change keeps the preset progress (index-keyed)', () => {
    const diatonic = (key: PitchClass): readonly Preset[] => [
      {
        id: 'test-diatonic',
        name: 'Test diatonic',
        pool: { kind: 'diatonic', key },
        voicingIds: ['any'],
      },
    ]
    const progress = new InMemoryPresetProgress()
    progress.set('test-diatonic', {
      unlockedCount: 5,
      masteredIndices: [1],
      setAsideIndices: [],
    })
    const { store } = setup({ presets: diatonic, progress })
    expect(store.getState().progress).toEqual({
      unlocked: 5,
      passed: 1,
      total: 7,
      setAside: 0,
    })

    store.getState().setDiatonicKey(7) // G major
    expect(store.getState().progress).toEqual({
      unlocked: 5,
      passed: 1,
      total: 7,
      setAside: 0,
    })
    expect(progress.get('test-diatonic')?.masteredIndices).toEqual([1])
  })

  it('setChordAside holds a chord out of the pool and persists it (§5.2)', () => {
    const progress = fullyUnlocked('test', 6)
    const s = setup({ presets: sixRoots, progress })

    s.store.getState().setChordAside('1:maj')
    expect(s.store.getState().progress.setAside).toBe(1)
    expect(progress.get('test')?.setAsideIndices).toEqual([1])
    expect(s.store.getState().chordPassStatus()[1]).toMatchObject({
      key: '1:maj',
      unlocked: true,
      setAside: true,
    })

    // Neither the live prompt nor the preview can name it any more.
    for (let i = 0; i < 20; i++) {
      expect(s.store.getState().prompt!.chord.root).not.toBe(1)
      s.store.getState().upcoming.forEach((u) => {
        expect(u.key.startsWith('1:')).toBe(false)
      })
      playSlowAndAdvance(s, s.store.getState().prompt!)
    }
  })

  it('setChordAside stops short of emptying the pool', () => {
    const progress = fullyUnlocked('test', 6)
    const s = setup({ presets: sixRoots, progress })
    for (const key of ['0:maj', '1:maj', '2:maj', '3:maj']) {
      s.store.getState().setChordAside(key)
    }
    // Three chords must stay in play, so the fourth call was a no-op.
    expect(s.store.getState().progress.setAside).toBe(3)
    expect(s.store.getState().canSetChordAside('3:maj')).toBe(false)
  })

  it('a set-aside chord does not hold up the next unlock (§5.2)', () => {
    const progress = new InMemoryPresetProgress()
    progress.set('test', {
      unlockedCount: 4,
      masteredIndices: [],
      setAsideIndices: [],
    })
    const s = setup({ presets: sixRoots, progress })
    s.store.getState().setChordAside('3:maj')

    let advances = 0
    while (s.store.getState().progress.unlocked === 4 && advances < 20) {
      playCorrectAndAdvance(s, s.store.getState().prompt!)
      advances++
    }
    // The three chords left in play passed; the benched one never blocked.
    expect(s.store.getState().progress.unlocked).toBe(4 + UNLOCK_BATCH_SIZE)
    expect(s.store.getState().progress.setAside).toBe(1)
  })

  it('openChordForPlay brings one back, and unlocks a locked one early', () => {
    const s = setup({ presets: sixRoots })
    expect(s.store.getState().chordsOpenedWith('4:maj')).toBe(1)

    s.store.getState().openChordForPlay('4:maj')
    // The frontier is a prefix, so chord 3 opened with it (§5.1).
    expect(s.store.getState().progress.unlocked).toBe(5)
    expect(s.store.getState().progress.passed).toBe(0)

    s.store.getState().setChordAside('0:maj')
    expect(s.store.getState().progress.setAside).toBe(1)
    s.store.getState().openChordForPlay('0:maj')
    expect(s.store.getState().progress.setAside).toBe(0)
    expect(s.store.getState().progress.unlocked).toBe(5)
  })

  it('Song mode draws from the full pool, not the unlocked subset', () => {
    const s = setup({ presets: sixRoots, rng: () => 0.999 })
    s.store.getState().setMode('song')
    // rng ≈ 1 picks from the top of the remaining pool — roots beyond the
    // unlocked first three appear because Song isn't gated (§6.5).
    const roots = s.store
      .getState()
      .songChords.map((c) => Number(c.key.split(':')[0]))
    expect(roots.some((r) => r > 2)).toBe(true)
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

  it('tracks consecutive first-try correct prompts, reset by a miss', () => {
    const bestStreak = new InMemoryBestStreak()
    const s = setup({ presets: onePreset, bestStreak })

    playCorrectAndAdvance(s, s.store.getState().prompt!) // first-try
    expect(s.store.getState().firstTryStreak).toBe(1)

    playCorrectAndAdvance(s, s.store.getState().prompt!) // first-try
    expect(s.store.getState().firstTryStreak).toBe(2)

    const prompt = s.store.getState().prompt!
    s.press(61, 62, 63) // miss…
    // …and the streak is gone at the ✘, not at the end of the prompt: the ✔
    // flash of a missed prompt must not claim a streak that already broke.
    expect(s.store.getState().firstTryStreak).toBe(0)
    s.releaseAll()
    playCorrectAndAdvance(s, prompt)
    expect(s.store.getState().firstTryStreak).toBe(0)
    expect(bestStreak.best()).toBe(2) // the lifetime high mark stays

    playCorrectAndAdvance(s, s.store.getState().prompt!) // first-try again
    expect(s.store.getState().firstTryStreak).toBe(1)
    expect(bestStreak.best()).toBe(2)
  })

  it('a first-try ✔ counts itself, in time for its own flash', () => {
    const s = setup({ presets: onePreset })

    s.press(...correctNotes(s.store.getState().prompt!))
    expect(s.store.getState().phase).toBe('advancing')
    expect(s.store.getState().firstTryStreak).toBe(1) // shown, not off by one
    s.releaseAll()
    vi.advanceTimersByTime(ADVANCE)
    expect(s.store.getState().firstTryStreak).toBe(1)
  })

  it('a mode switch ends the streak (§7.3)', () => {
    const s = setup({ presets: onePreset })
    playCorrectAndAdvance(s, s.store.getState().prompt!)
    playCorrectAndAdvance(s, s.store.getState().prompt!)
    expect(s.store.getState().firstTryStreak).toBe(2)

    // Only Practice can break a streak, so a detour through Learn or Song
    // would otherwise park the count and hand it back intact.
    s.store.getState().setMode('learn')
    expect(s.store.getState().firstTryStreak).toBe(0)

    s.store.getState().setMode('free')
    playCorrectAndAdvance(s, s.store.getState().prompt!)
    expect(s.store.getState().firstTryStreak).toBe(1) // starts over, not at 3
  })

  it('Learn prompts leave the streak alone (§5)', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().setMode('learn')

    playCorrectAndAdvance(s, s.store.getState().prompt!)
    expect(s.store.getState().firstTryStreak).toBe(0) // a Learn ✔ never counts
    s.press(61, 62, 63) // a Learn miss records nothing either
    expect(s.store.getState().firstTryStreak).toBe(0)
  })

  it('offers worst-only from persisted misses before anything is played', () => {
    // The gate reads the records, not what this page load happened to deal:
    // the sheet is opened from Home, before any prompt exists. Simulates a
    // reload holding yesterday's misses (the persisted stats implementation
    // is tested in storage/).
    const stats = new InMemoryComboStats()
    stats.record('0:maj:any', 'missed', 4000)
    stats.record('0:maj:any', 'first-try', 1000)

    const s = setup(
      { presets: onePreset, stats, progress: allPassed('test') },
      false, // no session, no prompt — Home
    )
    expect(s.store.getState().canDrillWorstOnly('test', 0)).toBe(true)
  })

  it('withholds worst-only when everything unlocked is passed and clean', () => {
    const stats = new InMemoryComboStats()
    stats.record('0:maj:any', 'first-try', 500)

    const s = setup(
      { presets: onePreset, stats, progress: allPassed('test') },
      false,
    )
    expect(s.store.getState().canDrillWorstOnly('test', 0)).toBe(false)
  })

  it('counts a not-yet-passed chord as worth drilling (§5.1)', () => {
    const s = setup({ presets: onePreset }, false)
    expect(s.store.getState().canDrillWorstOnly('test', 0)).toBe(true)
  })

  it('answers for the preset asked about, not the active one (§7.2)', () => {
    // The session sheet's picks are a draft — it asks about the preset the
    // player just selected in it, which the store hasn't switched to.
    const stats = new InMemoryComboStats()
    stats.record('5:min:any', 'missed', 4000)
    const both: readonly Preset[] = [
      {
        id: 'test',
        name: 'Test',
        pool: { kind: 'explicit', chords: [{ root: 0, typeId: 'maj' }] },
        voicingIds: ['any'],
      },
      {
        id: 'other',
        name: 'Other',
        pool: { kind: 'explicit', chords: [{ root: 5, typeId: 'min' }] },
        voicingIds: ['any'],
      },
    ]
    const progress = allPassed('test')
    progress.set('other', {
      unlockedCount: 1,
      masteredIndices: [0],
      setAsideIndices: [],
    })

    const s = setup({ presets: () => both, stats, progress }, false)
    expect(s.store.getState().presetId).toBe('test')
    expect(s.store.getState().canDrillWorstOnly('test', 0)).toBe(false)
    expect(s.store.getState().canDrillWorstOnly('other', 0)).toBe(true)
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
      avgTimeToCorrectMs: 0,
    })
    // The dead advance timer must not fire a second advance later.
    const next = s.store.getState().prompt
    vi.advanceTimersByTime(ADVANCE)
    expect(s.store.getState().prompt).toBe(next)
  })

  it('the diatonic preset drills the chosen key with key spelling', () => {
    const s = setup()
    s.store.getState().setPreset('diatonic')
    s.store.getState().setDiatonicKey(11) // B major

    const scalePcs = new Set([11, 1, 3, 4, 6, 8, 10])
    for (let i = 0; i < 10; i++) {
      const prompt = s.store.getState().prompt!
      expect(scalePcs.has(prompt.chord.root)).toBe(true)
      // Key spelling, e.g. D♯ min — never the default policy's E♭.
      expect(prompt.displayName).not.toContain('♭')
      playSlowAndAdvance(s, prompt)
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

    s.store.getState().setMode('free')
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
})

describe('practiceStore — worst chords only (§5/§7)', () => {
  const sixRoots = presetsOf({
    kind: 'product',
    roots: [0, 1, 2, 3, 4, 5],
    chordTypes: ['maj'],
  })

  it('draws from the missed combos and the not-yet-passed ones', () => {
    const stats = new InMemoryComboStats()
    stats.record('0:maj:any', 'missed', 4000) // missed → worst
    stats.record('1:maj:any', 'first-try', 1000) // passed and clean → skipped

    // Everything unlocked, all passed except roots 3 and 4 — the chords still
    // being learned, which the toggle drills alongside the missed one.
    const progress = new InMemoryPresetProgress()
    progress.set('test', {
      unlockedCount: 6,
      masteredIndices: [0, 1, 2, 5],
      setAsideIndices: [],
    })

    const s = setup({ presets: sixRoots, stats, progress })
    s.store.getState().setWorstOnly(true)
    const seen = new Set<number>()
    for (let i = 0; i < 30; i++) {
      const root = s.store.getState().prompt!.chord.root
      expect([0, 3, 4]).toContain(root)
      seen.add(root)
      playSlowAndAdvance(s, s.store.getState().prompt!)
    }
    expect(seen).toContain(3) // the learning chords really are in the draw
    expect(seen).toContain(4)
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
      playSlowAndAdvance(s, s.store.getState().prompt!)
    }
    expect(seen.size).toBeGreaterThan(1) // not pinned to the one missed combo
  })
})

describe('practiceStore — the learn loop (§5.4)', () => {
  const sixRoots = presetsOf({
    kind: 'product',
    roots: [0, 1, 2, 3, 4, 5],
    chordTypes: ['maj'],
  })

  // Fully unlocked six-root pool with roots 0 and 3 already passed
  // (chordOrder indices match root order 1:1 for a single-type pool).
  const partlyPassed = (): InMemoryPresetProgress => {
    const progress = new InMemoryPresetProgress()
    progress.set('test', {
      unlockedCount: 6,
      masteredIndices: [0, 3],
      setAsideIndices: [],
    })
    return progress
  }

  it('defaults its set to the in-play chords not yet passed', () => {
    const s = setup({ presets: sixRoots, progress: partlyPassed() })
    expect(s.store.getState().learnSelection).toEqual([
      '1:maj',
      '2:maj',
      '4:maj',
      '5:maj',
    ])
  })

  it('deals only the selected chords when the set already makes three', () => {
    const s = setup({ presets: sixRoots, progress: partlyPassed() })
    s.store.getState().setMode('learn')
    s.store.getState().setLearnSelection(['1:maj', '2:maj', '4:maj'])
    for (let i = 0; i < 20; i++) {
      expect([1, 2, 4]).toContain(s.store.getState().prompt!.chord.root)
      playSlowAndAdvance(s, s.store.getState().prompt!)
    }
  })

  it('fills a one-chord set out to three with learned chords', () => {
    const s = setup({ presets: sixRoots, progress: partlyPassed() })
    s.store.getState().setMode('learn')
    s.store.getState().setLearnSelection(['5:maj'])
    const seen = new Set<number>()
    for (let i = 0; i < 30; i++) {
      seen.add(s.store.getState().prompt!.chord.root)
      playSlowAndAdvance(s, s.store.getState().prompt!)
    }
    // The selected chord plus the two most recently passed ones (roots 3, 0);
    // the chords still being learned that weren't picked stay out.
    expect([...seen].sort()).toEqual([0, 3, 5])
  })

  it('records nothing persisted — no stats, no unlock progress', () => {
    const stats = new InMemoryComboStats()
    const progress = partlyPassed()
    const s = setup({ presets: sixRoots, progress, stats })
    s.store.getState().setMode('learn')
    s.store.getState().setLearnSelection(['1:maj', '2:maj', '4:maj'])
    for (let i = 0; i < 12; i++) {
      playCorrectAndAdvance(s, s.store.getState().prompt!)
      if (s.store.getState().report !== null) break
    }
    expect(
      stats.get(comboKey({ root: 1, typeId: 'maj', voicingId: 'any' })),
    ).toBeNull()
    expect(progress.get('test')).toEqual({
      unlockedCount: 6,
      masteredIndices: [0, 3],
      setAsideIndices: [],
    })
  })

  it('ends the session once every selected chord reaches D', () => {
    const s = setup({ presets: sixRoots, progress: partlyPassed() })
    s.store.getState().setMode('learn')
    s.store.getState().setLearnSelection(['1:maj', '2:maj', '4:maj'])
    // Fast, clean reps: each chord passes on about its second (§5.1 evidence
    // floor), so the set is done well inside this bound.
    for (let i = 0; i < 40 && s.store.getState().report === null; i++) {
      playCorrectAndAdvance(s, s.store.getState().prompt!)
    }
    const report = s.store.getState().report
    expect(report).not.toBeNull()
    expect(report!.learn?.remaining).toEqual([])
    expect(report!.learn?.rehearsed).toHaveLength(3)
    // Rehearsed is not passed (§5.4) — the Report's pass list stays empty.
    expect(report!.passedLabels).toEqual([])
    expect(report!.grade).toBeNull() // Learn is still ungraded (§7.4)
  })

  it('is not ended by a filler chord reaching the bar', () => {
    const s = setup({ presets: sixRoots, progress: partlyPassed() })
    s.store.getState().setMode('learn')
    s.store.getState().setLearnSelection(['5:maj'])
    // Answer only the filler chords cleanly; the selected one is played slowly
    // enough to grade F, so it never rehearses and the loop can't finish.
    for (let i = 0; i < 30; i++) {
      const prompt = s.store.getState().prompt!
      if (prompt.chord.root === 5) playSlowAndAdvance(s, prompt)
      else playCorrectAndAdvance(s, prompt)
    }
    expect(s.store.getState().report).toBeNull()
    expect(s.store.getState().learnProgress.rehearsed).toBe(0)
  })

  it('grades from this session alone — a fresh session starts over', () => {
    const s = setup({ presets: sixRoots, progress: partlyPassed() })
    s.store.getState().setMode('learn')
    s.store.getState().setLearnSelection(['1:maj', '2:maj', '4:maj'])
    for (let i = 0; i < 40 && s.store.getState().report === null; i++) {
      playCorrectAndAdvance(s, s.store.getState().prompt!)
    }
    expect(s.store.getState().learnProgress.rehearsed).toBe(3)

    s.store.getState().dismissReport()
    s.store.getState().discardSession()
    enterStage(s)
    expect(s.store.getState().learnProgress.rehearsed).toBe(0)
  })

  it('drops a chord from the set when it is put aside (§5.2)', () => {
    const s = setup({ presets: sixRoots, progress: partlyPassed() }, false)
    s.store.getState().setLearnSelection(['1:maj', '2:maj', '4:maj'])
    s.store.getState().setChordAside('2:maj')
    expect(s.store.getState().learnSelection).toEqual(['1:maj', '4:maj'])
  })

  it('re-derives the set when the preset changes under it', () => {
    const twoPresets = (): readonly Preset[] => [
      {
        id: 'test',
        name: 'Test',
        pool: sixRoots()[0]!.pool,
        voicingIds: ['any'],
      },
      {
        id: 'other',
        name: 'Other',
        pool: { kind: 'explicit', chords: [{ root: 7, typeId: 'min' }] },
        voicingIds: ['any'],
      },
    ]
    const s = setup({ presets: twoPresets, progress: partlyPassed() }, false)
    s.store.getState().setLearnSelection(['1:maj'])
    s.store.getState().setPreset('other')
    expect(s.store.getState().learnSelection).toEqual(['7:min'])
  })

  it('leaves the practice modes alone', () => {
    const s = setup({ presets: sixRoots, progress: partlyPassed() })
    s.store.getState().setLearnSelection(['1:maj']) // still in Practice
    const seen = new Set<number>()
    for (let i = 0; i < 30; i++) {
      seen.add(s.store.getState().prompt!.chord.root)
      playSlowAndAdvance(s, s.store.getState().prompt!)
    }
    expect(seen.size).toBeGreaterThan(3)
  })
})

describe('practiceStore — session length & report (§7.2/§7.4)', () => {
  const onePreset = presetsOf({
    kind: 'explicit',
    chords: [{ root: 0, typeId: 'maj' }],
  })

  it('reaching the length ends the session and builds a report', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().setSessionLength({ unit: 'prompts', value: 3 })
    for (let i = 0; i < 3; i++) {
      playCorrectAndAdvance(s, s.store.getState().prompt!)
    }
    const state = s.store.getState()
    expect(state.report).not.toBeNull()
    expect(state.report!.promptsPlayed).toBe(3)
    expect(state.report!.recordedPrompts).toBe(3)
    expect(state.report!.accuracy).toBe(1)
    expect(state.prompt).toBeNull()
    expect(state.phase).toBe('idle')
  })

  it('an F session offers its worst chord for setting aside (§5.2)', () => {
    const sixRoots = presetsOf({
      kind: 'product',
      roots: [0, 1, 2, 3, 4, 5],
      chordTypes: ['maj'],
    })
    const s = setup({ presets: sixRoots, progress: fullyUnlocked('test', 6) })
    // Clean but far past D's second: every chord grades F on speed alone,
    // and enough reps to clear the evidence floor so none of them read `new`.
    for (let i = 0; i < 40; i++) {
      playSlowAndAdvance(s, s.store.getState().prompt!)
    }
    s.store.getState().endSession()

    const suggestion = s.store.getState().report!.suggestion
    expect(s.store.getState().report!.grade).toBe('F')
    expect(suggestion?.kind).toBe('set-aside')

    // Acting on it takes the named chord out of play.
    s.store.getState().setChordAside(suggestion!.chordKey)
    expect(s.store.getState().progress.setAside).toBe(1)
  })

  it('a Learn session ignores the length — it ends on its set (§5.4)', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().setMode('learn')
    s.store.getState().setSessionLength({ unit: 'prompts', value: 2 })
    // Slow reps grade F, so the one selected chord never rehearses and the
    // only thing that could end this session is the length — which doesn't
    // apply.
    for (let i = 0; i < 6; i++) {
      playSlowAndAdvance(s, s.store.getState().prompt!)
    }
    expect(s.store.getState().report).toBeNull()
    expect(s.store.getState().done).toBe(6)
  })

  it('∞ length never auto-ends', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().setSessionLength({ unit: 'prompts', value: null })
    for (let i = 0; i < 25; i++) {
      playCorrectAndAdvance(s, s.store.getState().prompt!)
    }
    expect(s.store.getState().report).toBeNull()
    expect(s.store.getState().prompt).not.toBeNull()
    expect(s.store.getState().done).toBe(25)
  })

  it('End builds a report immediately, counting a pending ✔', () => {
    const stats = new InMemoryComboStats()
    const s = setup({ presets: onePreset, stats })
    s.press(...correctNotes(s.store.getState().prompt!))
    expect(s.store.getState().phase).toBe('advancing')

    s.store.getState().endSession()
    const report = s.store.getState().report
    expect(report).not.toBeNull()
    expect(report!.recordedPrompts).toBe(1)
    expect(stats.get('0:maj:any')?.attempts).toBe(1)
    // The dead advance timer must not deal a prompt over the report.
    vi.advanceTimersByTime(ADVANCE)
    expect(s.store.getState().prompt).toBeNull()
    s.releaseAll()
  })

  it('ending with zero prompts played returns no report (§7.2)', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().endSession()
    expect(s.store.getState().report).toBeNull()
    expect(s.store.getState().prompt).toBeNull()
  })

  it('input and start are ignored while a report is open', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().setSessionLength({ unit: 'prompts', value: 1 })
    playCorrectAndAdvance(s, s.store.getState().prompt!)
    expect(s.store.getState().report).not.toBeNull()

    s.press(60, 64, 67)
    expect(s.store.getState().phase).toBe('idle')
    s.store.getState().start()
    expect(s.store.getState().prompt).toBeNull()
    s.releaseAll()
  })

  it('dismissing the report and starting again begins a fresh session', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().setSessionLength({ unit: 'prompts', value: 1 })
    playCorrectAndAdvance(s, s.store.getState().prompt!)
    expect(s.store.getState().report).not.toBeNull()

    s.store.getState().dismissReport()
    enterStage(s) // Go again
    const state = s.store.getState()
    expect(state.report).toBeNull()
    expect(state.prompt).not.toBeNull()
    expect(state.phase).toBe('armed')
    expect(state.done).toBe(0)
    expect(state.session.prompts).toBe(0)
  })

  it('a Learn session reports prompts played but no grade (§7.4)', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().setMode('learn')
    for (let i = 0; i < 10 && s.store.getState().report === null; i++) {
      playCorrectAndAdvance(s, s.store.getState().prompt!)
    }
    const report = s.store.getState().report
    expect(report).not.toBeNull()
    expect(report!.mode).toBe('learn')
    expect(report!.grade).toBeNull()
    expect(report!.promptsPlayed).toBeGreaterThan(0)
    expect(report!.recordedPrompts).toBe(0) // Learn is stats-neutral (§5)
  })

  it('a minutes length ends the session on active time, not prompts', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().setSessionLength({ unit: 'minutes', value: 5 })
    // Each rep contributes the gap since the previous held-note event, and
    // only if that gap is inside the idle window (activeTime.ts) — so ~21 s of
    // playing per prompt reaches 5 minutes in 16, many more prompts than any
    // prompt length would have allowed.
    for (let i = 0; i < 15; i++) {
      vi.advanceTimersByTime(20_000)
      playCorrectAndAdvance(s, s.store.getState().prompt!)
    }
    expect(s.store.getState().report).toBeNull()
    expect(s.store.getState().sessionActiveMs).toBeGreaterThan(4 * 60_000)

    vi.advanceTimersByTime(20_000)
    playCorrectAndAdvance(s, s.store.getState().prompt!)
    expect(s.store.getState().report).not.toBeNull()
    expect(s.store.getState().report!.promptsPlayed).toBe(16)
  })

  it('idling never runs a timed session out', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().setSessionLength({ unit: 'minutes', value: 5 })
    // Gaps past the idle window earn no active time (§7.6), so an hour of
    // walking away leaves the cap exactly where it was.
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(6 * 60_000)
      playCorrectAndAdvance(s, s.store.getState().prompt!)
    }
    expect(s.store.getState().report).toBeNull()
    expect(s.store.getState().sessionActiveMs).toBeLessThan(60_000)
  })
})

// Daily practice (§5.3): the maintenance drill over every chord already
// learned, wherever it was learned, run to a persisted time cap.
describe('practiceStore — daily practice (§5.3)', () => {
  // Two presets: C/D major learned in the first, F minor in the second, and
  // E major reached but not passed anywhere.
  const twoPresets = (): readonly Preset[] => [
    {
      id: 'first',
      name: 'First',
      pool: {
        kind: 'explicit',
        chords: [
          { root: 0, typeId: 'maj' },
          { root: 2, typeId: 'maj' },
          { root: 4, typeId: 'maj' },
          { root: 7, typeId: 'maj' },
        ],
      },
      voicingIds: ['any'],
    },
    {
      id: 'second',
      name: 'Second',
      pool: { kind: 'explicit', chords: [{ root: 5, typeId: 'min' }] },
      voicingIds: ['any'],
    },
  ]

  const learnedProgress = () => {
    const progress = new InMemoryPresetProgress()
    progress.set('first', {
      unlockedCount: 4,
      // C maj, D maj learned; E maj and G maj unlocked but not passed.
      masteredIndices: [0, 1],
      setAsideIndices: [],
    })
    progress.set('second', {
      unlockedCount: 1,
      masteredIndices: [0], // F min
      setAsideIndices: [],
    })
    return progress
  }

  const dailySetup = (
    extra: Parameters<typeof createPracticeStore>[0] = {},
  ) => {
    const s = setup(
      { presets: twoPresets, progress: learnedProgress(), ...extra },
      false,
    )
    s.store.getState().setMode('daily')
    enterStage(s)
    return s
  }

  it('counts the learned chords of every preset', () => {
    const s = setup({ presets: twoPresets, progress: learnedProgress() }, false)
    expect(s.store.getState().learnedChordCount()).toBe(3)
  })

  it('deals learned chords from every preset and nothing else', () => {
    const s = dailySetup()
    const seen = new Set<string>()
    for (let i = 0; i < 30; i++) {
      const prompt = s.store.getState().prompt!
      seen.add(`${prompt.chord.root}:${prompt.chord.type.id}`)
      playSlowAndAdvance(s, prompt)
    }
    expect([...seen].sort()).toEqual(['0:maj', '2:maj', '5:min'])
  })

  it('records outcomes like free practice does', () => {
    const stats = new InMemoryComboStats()
    const s = dailySetup({ stats })
    const prompt = s.store.getState().prompt!
    playCorrectAndAdvance(s, prompt)
    expect(stats.get(promptComboKey(prompt))?.attempts).toBe(1)
  })

  it('never moves the selected preset’s unlock progress', () => {
    // The active preset is the first, where E maj and G maj are unlocked but
    // unpassed — daily deals neither, and passes nothing it does deal.
    const progress = learnedProgress()
    const s = dailySetup({ progress })
    for (let i = 0; i < 20; i++) {
      playCorrectAndAdvance(s, s.store.getState().prompt!)
      expect(s.store.getState().justLearned).toBe(false)
    }
    expect(s.store.getState().progress).toMatchObject({
      unlocked: 4,
      passed: 2,
    })
    expect(progress.get('first')).toEqual({
      unlockedCount: 4,
      masteredIndices: [0, 1],
      setAsideIndices: [],
    })
  })

  it('runs to the persisted cap rather than the drafted length', () => {
    const s = dailySetup({
      settings: () => ({ ...DEFAULT_PRACTICE_SETTINGS, dailyCapMinutes: 5 }),
    })
    // A prompt length is set but must not apply — the cap is minutes (§5.3).
    s.store.getState().setSessionLength({ unit: 'prompts', value: 2 })
    for (let i = 0; i < 15; i++) {
      vi.advanceTimersByTime(20_000)
      playCorrectAndAdvance(s, s.store.getState().prompt!)
    }
    expect(s.store.getState().report).toBeNull()

    vi.advanceTimersByTime(20_000)
    playCorrectAndAdvance(s, s.store.getState().prompt!)
    expect(s.store.getState().report).not.toBeNull()
    expect(s.store.getState().report!.mode).toBe('daily')
    expect(s.store.getState().report!.suggestion).toBeNull() // free only (§7.4)
  })

  it('picks up chords passed in free practice without a reload', () => {
    const s = setup({ presets: twoPresets, progress: learnedProgress() }, false)
    expect(s.store.getState().learnedChordCount()).toBe(3)

    // Pass the rest of the active preset in free practice — clean, fast reps
    // until each grades D or better (§5.1) — and the daily pool grows with it.
    enterStage(s)
    s.store.getState().setSessionLength({ unit: 'prompts', value: null })
    for (let i = 0; i < 40; i++) {
      playCorrectAndAdvance(s, s.store.getState().prompt!)
    }
    expect(s.store.getState().progress.passed).toBe(4)
    expect(s.store.getState().learnedChordCount()).toBe(5)
  })

  it('drops a set-aside chord out of the daily pool too (§5.2)', () => {
    const s = setup({ presets: twoPresets, progress: learnedProgress() }, false)
    s.store.getState().setChordAside('0:maj')
    expect(s.store.getState().progress.setAside).toBe(1)
    expect(s.store.getState().learnedChordCount()).toBe(2)
  })
})

// A session exists only between the Stage's start() and the end of the
// session (§7.2). Home's mode chips and the session sheet's pickers run
// against a store with no session live, so none of them may deal a prompt,
// judge input or record anything.
// A combo's grade rides a recent window (§5), so it can climb mid-session —
// the toast says so while the player is still on that chord (§7.3), instead of
// leaving it for their next visit to the chord stats page.
describe('practiceStore — grade-up notice (§7.3)', () => {
  const onePreset = presetsOf({
    kind: 'explicit',
    chords: [{ root: 0, typeId: 'maj' }],
  })
  const KEY = '0:maj:any'

  // A full recent window, oldest first, seeded at S speed (§7.5's 1 s) so the
  // speed axis is full credit and the letter is pure accuracy: 7 of 10 is a B.
  // The next first-try pushes the oldest miss out of the window — 8 of 10, an
  // A — which is what a climb looks like once two misses make a letter.
  const seeded = () => {
    const stats = new InMemoryComboStats()
    const history = [
      'missed',
      'missed',
      'missed',
      ...Array<'first-try'>(RECENT_OUTCOME_WINDOW - 3).fill('first-try'),
    ] as const
    for (const outcome of history) stats.record(KEY, outcome, GRADE_TIME_MS.S)
    return stats
  }

  // The notice rides the ✔ flash of the rep that earned it (§7.3): it lands
  // with the flash, not on a window of its own, and the next ✔ replaces it.
  it('announces a combo whose grade climbs, on the ✔ that earned it', () => {
    const stats = seeded()
    expect(comboGrade(comboMetrics(stats.get(KEY)!).score)).toBe('B')
    const s = setup({ presets: onePreset, stats })

    const prompt = s.store.getState().prompt!
    s.press(...correctNotes(prompt)) // 8/10 → A, announced with the ✔
    expect(s.store.getState().phase).toBe('advancing')
    expect(s.store.getState().gradeUp).toEqual({
      label: 'C maj',
      from: 'B',
      to: 'A',
    })

    s.releaseAll()
    vi.advanceTimersByTime(ADVANCE)
    playCorrectAndAdvance(s, s.store.getState().prompt!) // 9/10, still an A
    expect(s.store.getState().gradeUp).toBeNull()
  })

  it('stays quiet while a grade would still be noise', () => {
    // A combo with no history at all grades S off its first success — true but
    // meaningless, and the §7.5 stats page has the same floor.
    const s = setup({ presets: onePreset })
    playCorrectAndAdvance(s, s.store.getState().prompt!)
    expect(s.store.getState().gradeUp).toBeNull()
  })

  // A letter sitting on a cut point is crossed again every few reps, so the
  // same climb would announce itself over and over (§7.3).
  it('announces a letter once per session, however the grade fluctuates', () => {
    const stats = seeded()
    const s = setup({ presets: onePreset, stats })
    const gradeNow = () => comboGrade(comboMetrics(stats.get(KEY)!).score)
    const missThenCorrect = () => {
      const prompt = s.store.getState().prompt!
      s.press(61, 62, 63)
      s.releaseAll()
      playCorrectAndAdvance(s, prompt)
    }
    const clean = () => playCorrectAndAdvance(s, s.store.getState().prompt!)

    clean() // 8/10 → A, announced
    expect(gradeNow()).toBe('A')
    expect(s.store.getState().gradeUp).not.toBeNull()
    vi.advanceTimersByTime(JUST_UNLOCKED_FLASH_MS)

    for (let i = 0; i < 3; i++) missThenCorrect() // back down to B
    expect(gradeNow()).toBe('B')

    for (let i = 0; i < 8; i++) clean() // and back up to the same A
    expect(gradeNow()).toBe('A')
    expect(s.store.getState().gradeUp).toBeNull()

    for (let i = 0; i < 2; i++) clean() // 10/10 at S speed — a new letter
    expect(gradeNow()).toBe('S')
    expect(s.store.getState().gradeUp).toEqual({
      label: 'C maj',
      from: 'A',
      to: 'S',
    })
  })

  it('stays quiet when the grade holds or drops', () => {
    const stats = seeded()
    const s = setup({ presets: onePreset, stats })

    const prompt = s.store.getState().prompt!
    s.press(61, 62, 63) // miss…
    s.releaseAll()
    playCorrectAndAdvance(s, prompt) // …recorded as missed: 7/11, still B or worse

    expect(s.store.getState().gradeUp).toBeNull()
  })
})

// The §7.3 ready gate: Practice holds its first prompt until the player is
// set, so the time-to-correct it records is the time to play the chord — not
// the walk-up to the keyboard (which used to inflate the first sample past the
// §5.1 pass bar).
describe('practiceStore — ready gate (§7.3)', () => {
  const onePreset = presetsOf({
    kind: 'explicit',
    chords: [{ root: 0, typeId: 'maj' }],
  })

  it('Practice deals nothing until the gate is answered', () => {
    const s = setup({ presets: onePreset }, false)
    s.store.getState().start()

    expect(s.store.getState().awaitingReady).toBe(true)
    expect(s.store.getState().prompt).toBeNull()
    expect(s.store.getState().phase).toBe('idle')

    s.store.getState().ready() // the Stage's Ready panel
    expect(s.store.getState().awaitingReady).toBe(false)
    expect(s.store.getState().prompt).not.toBeNull()
    expect(s.store.getState().phase).toBe('armed')
  })

  it('any note answers the gate, and arms on release (§6.2 step 1)', () => {
    const s = setup({ presets: onePreset }, false)
    s.store.getState().start()

    s.press(48) // any key at all — not the chord
    expect(s.store.getState().prompt).not.toBeNull()
    expect(s.store.getState().phase).toBe('awaiting-release')

    s.releaseAll()
    expect(s.store.getState().phase).toBe('armed')
  })

  it('the waiting time never lands in time-to-correct', () => {
    const stats = new InMemoryComboStats()
    const s = setup({ presets: onePreset, stats }, false)
    s.store.getState().start()

    vi.advanceTimersByTime(9000) // finding the stool, plugging in, whatever
    s.store.getState().ready()
    vi.advanceTimersByTime(700)
    playCorrectAndAdvance(s, s.store.getState().prompt!)

    expect(stats.get('0:maj:any')?.timeToCorrectMs).toEqual([700])
  })

  it('Learn and Song deal on start, ungated', () => {
    const learn = setup({ presets: onePreset }, false)
    learn.store.getState().setMode('learn')
    learn.store.getState().start()
    expect(learn.store.getState().awaitingReady).toBe(false)
    expect(learn.store.getState().prompt).not.toBeNull()

    const song = setup({ presets: onePreset }, false)
    song.store.getState().setMode('song')
    song.store.getState().start()
    expect(song.store.getState().awaitingReady).toBe(false)
    expect(song.store.getState().song?.countingIn).toBe(true)
  })

  it('a pool change while the gate is up leaves it up', () => {
    const s = setup({ presets: onePreset }, false)
    s.store.getState().start()

    // The sheet's Practice toggle over a gated session (it pauses the session,
    // so there's no prompt on screen to replace).
    s.store.getState().setWorstOnly(true)

    expect(s.store.getState().awaitingReady).toBe(true)
    expect(s.store.getState().prompt).toBeNull()
  })

  it('switching to Learn while gated deals immediately', () => {
    const s = setup({ presets: onePreset }, false)
    s.store.getState().start()
    s.store.getState().setMode('learn')

    expect(s.store.getState().awaitingReady).toBe(false)
    expect(s.store.getState().prompt).not.toBeNull()
  })
})

describe('practiceStore — session lifecycle (§7.2)', () => {
  const onePreset = presetsOf({
    kind: 'explicit',
    chords: [{ root: 0, typeId: 'maj' }],
  })

  it('config changes deal no prompt before a session starts', () => {
    const s = setup({ presets: onePreset }, false)
    expect(s.store.getState().prompt).toBeNull()

    s.store.getState().setMode('learn')
    s.store.getState().setLearnSelection(['0:maj'])
    s.store.getState().setSessionLength({ unit: 'prompts', value: 10 })

    expect(s.store.getState().prompt).toBeNull()
    expect(s.store.getState().phase).toBe('idle')
    expect(s.store.getState().mode).toBe('learn')
  })

  it('the Song chip starts no clock outside a session', () => {
    const s = setup({ presets: onePreset }, false)
    s.store.getState().setMode('song')
    expect(s.store.getState().song).toBeNull()
    expect(s.store.getState().prompt).toBeNull()
  })

  it('keys played before a session are never judged or recorded', () => {
    const stats = new InMemoryComboStats()
    const s = setup({ presets: onePreset, stats }, false)
    s.store.getState().setMode('learn') // the Home mode chip

    s.press(60, 64, 67) // a correct C major, on Home

    expect(s.store.getState().phase).toBe('idle')
    expect(stats.get('0:maj:any')).toBeNull()
    expect(s.store.getState().done).toBe(0)
    expect(s.store.getState().report).toBeNull()
    s.releaseAll()
  })

  it('the mode chosen before Start is the mode the session runs in', () => {
    const s = setup({ presets: onePreset }, false)
    s.store.getState().setMode('learn')
    s.store.getState().start()
    expect(s.store.getState().mode).toBe('learn')
    expect(s.store.getState().prompt).not.toBeNull()
    expect(s.store.getState().phase).toBe('armed')
  })

  it('a config change between sessions never leaks into the next one', () => {
    const s = setup({ presets: onePreset }, false)
    s.store.getState().setSessionLength({ unit: 'prompts', value: 2 })
    enterStage(s)
    for (let i = 0; i < 2; i++) {
      playCorrectAndAdvance(s, s.store.getState().prompt!)
    }
    expect(s.store.getState().report!.recordedPrompts).toBe(2)
    s.store.getState().dismissReport()

    s.store.getState().setMode('free') // already practice — a no-op
    s.store.getState().setPreset('test') // the sheet's picker, unchanged
    expect(s.store.getState().prompt).toBeNull()

    enterStage(s)
    expect(s.store.getState().done).toBe(0)
    expect(s.store.getState().session).toEqual({
      prompts: 0,
      firstTrySuccesses: 0,
      totalTimeToCorrectMs: 0,
    })

    playCorrectAndAdvance(s, s.store.getState().prompt!)
    expect(s.store.getState().report).toBeNull() // 1 of 2, not 3 of 2
    expect(s.store.getState().done).toBe(1)
  })

  it('start resumes a paused session instead of restarting it', () => {
    // The §6.1 gate raised by an unplug, or the session sheet opened over the
    // Stage: the Stage unmounts and remounts around the same session.
    const s = setup({ presets: onePreset }, false)
    s.store.getState().setSessionLength({ unit: 'prompts', value: null })
    enterStage(s)
    playCorrectAndAdvance(s, s.store.getState().prompt!)

    s.store.getState().pause()
    expect(s.store.getState().prompt).toBeNull()

    enterStage(s)
    expect(s.store.getState().done).toBe(1)
    expect(s.store.getState().session.prompts).toBe(1)
    expect(s.store.getState().prompt).not.toBeNull()
  })

  it('a resumed session reports everything it played, across the pause', () => {
    const s = setup({ presets: onePreset }, false)
    s.store.getState().setSessionLength({ unit: 'prompts', value: null })
    enterStage(s)
    playCorrectAndAdvance(s, s.store.getState().prompt!)
    s.store.getState().pause()
    enterStage(s)
    playCorrectAndAdvance(s, s.store.getState().prompt!)

    s.store.getState().endSession()
    expect(s.store.getState().report!.recordedPrompts).toBe(2)
  })

  it('discardSession makes the next start a fresh session', () => {
    const s = setup({ presets: onePreset }, false)
    s.store.getState().setSessionLength({ unit: 'prompts', value: null })
    enterStage(s)
    playCorrectAndAdvance(s, s.store.getState().prompt!)

    s.store.getState().discardSession() // Start / Go again
    expect(s.store.getState().prompt).toBeNull()
    expect(s.store.getState().report).toBeNull() // discarded, not reported

    enterStage(s)
    expect(s.store.getState().done).toBe(0)
    expect(s.store.getState().session.prompts).toBe(0)
  })

  it('discardSession still counts a pending ✔ toward lifetime stats', () => {
    const stats = new InMemoryComboStats()
    const s = setup({ presets: onePreset, stats }, false)
    enterStage(s)
    s.press(...correctNotes(s.store.getState().prompt!))
    expect(s.store.getState().phase).toBe('advancing')

    s.store.getState().discardSession()
    expect(stats.get('0:maj:any')?.attempts).toBe(1)
    // The dead advance timer must not deal a prompt into the discarded session.
    vi.advanceTimersByTime(ADVANCE)
    expect(s.store.getState().prompt).toBeNull()
    s.releaseAll()
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

    // Returning re-raises the §7.3 gate: the resumed prompt's clock starts
    // when the player says they're back, not when the Stage remounts.
    s.store.getState().start()
    expect(s.store.getState().awaitingReady).toBe(true)
    expect(s.store.getState().prompt).toBeNull()

    s.store.getState().ready()
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

  it('start never deals a prompt over an open report', () => {
    const s = setup({ presets: onePreset })
    s.store.getState().setSessionLength({ unit: 'prompts', value: 1 })
    playCorrectAndAdvance(s, s.store.getState().prompt!) // reaches length → report
    expect(s.store.getState().report).not.toBeNull()

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

  it('records hits and misses per bar with no time sample, feeding the session', () => {
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
    // A Song bar counts as a played prompt in the session (§7.4) — hit or
    // miss — but carries no time sample.
    const state = s.store.getState()
    expect(state.session.prompts).toBe(2)
    expect(state.session.firstTrySuccesses).toBe(1)
    expect(state.session.totalTimeToCorrectMs).toBe(0)
    expect(state.done).toBe(2)
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
    s.store.getState().setMode('free')
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
