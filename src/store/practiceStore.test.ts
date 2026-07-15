import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chordPitchClasses } from '../theory'
import { comboKey, MAJOR_TRIADS_COMBOS } from '../practice'
import { AUTO_ADVANCE_MS, createPracticeStore } from './practiceStore'
import type { Combo, Prompt } from '../practice'

function setup(deps: Parameters<typeof createPracticeStore>[0] = {}) {
  const store = createPracticeStore(deps)
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
    vi.advanceTimersByTime(AUTO_ADVANCE_MS)
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

    vi.advanceTimersByTime(AUTO_ADVANCE_MS - 1)
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

  it('wrong input does nothing (correct-path only in Phase 3)', () => {
    const { store, press, releaseAll } = setup()
    press(61, 62, 63) // a cluster that is no major triad
    expect(store.getState().phase).toBe('armed')
    expect(store.getState().reactionMs).toBeNull()
    releaseAll()
    expect(store.getState().phase).toBe('armed')
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

    vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    expect(store.getState().phase).toBe('armed') // empty hands → armed directly
  })

  it('a correct chord released before the advance still advances armed', () => {
    const { store, press, releaseAll } = setup()
    press(...correctNotes(store.getState().prompt!))
    releaseAll()
    vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    expect(store.getState().phase).toBe('armed')
  })
})

describe('practiceStore — generation', () => {
  it('never repeats a prompt within the recent window', () => {
    const pool: Combo[] = MAJOR_TRIADS_COMBOS.slice(0, 6).map((c) => ({ ...c }))
    const { store, press, releaseAll } = setup({ pool })
    const seen: string[] = []

    for (let i = 0; i < 50; i++) {
      const prompt = store.getState().prompt!
      const key = comboKey({
        root: prompt.chord.root,
        typeId: prompt.chord.type.id,
        voicingId: prompt.voicing.id,
      })
      expect(seen.slice(-3)).not.toContain(key)
      seen.push(key)

      press(...correctNotes(prompt))
      releaseAll()
      vi.advanceTimersByTime(AUTO_ADVANCE_MS)
    }
  })
})
