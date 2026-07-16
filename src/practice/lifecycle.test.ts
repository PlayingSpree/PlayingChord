import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttemptLifecycle, type LifecycleState } from './lifecycle'
import { createPrompt } from './prompts'
import { DEFAULT_PRACTICE_SETTINGS, type PracticeSettings } from './settings'
import type { ChordTypeId } from '../theory'

// MIDI shorthand: C4=60 C♯4=61 E4=64 G4=67 C5=72 E5=76

const STALL = DEFAULT_PRACTICE_SETTINGS.judgmentDelayMs
const ADVANCE = DEFAULT_PRACTICE_SETTINGS.autoAdvanceMs

const prompt = (root: number, typeId: ChordTypeId, voicingId: string) =>
  createPrompt({ root, typeId, voicingId })

function setup(overrides: Partial<PracticeSettings> = {}) {
  const settings: PracticeSettings = {
    ...DEFAULT_PRACTICE_SETTINGS,
    ...overrides,
  }
  const advances: number[] = []
  const emitted: LifecycleState[] = []
  const machine = new AttemptLifecycle({
    settings: () => settings,
    now: () => Date.now(), // driven by fake timers
    onState: (state) => emitted.push(state),
    onAdvance: () => advances.push(Date.now()),
  })
  let held = new Set<number>()
  const press = (...notes: number[]) => {
    held = new Set([...held, ...notes])
    machine.heldChange(held)
  }
  const release = (...notes: number[]) => {
    held = new Set([...held].filter((n) => !notes.includes(n)))
    machine.heldChange(held)
  }
  const releaseAll = () => {
    held = new Set()
    machine.heldChange(held)
  }
  return { machine, settings, advances, emitted, press, release, releaseAll }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('lifecycle — arming (§6.2 step 1)', () => {
  it('arms immediately when no keys are held', () => {
    const { machine } = setup()
    machine.promptShown(prompt(0, 'maj', 'any'))
    expect(machine.state.phase).toBe('armed')
  })

  it('waits for all keys to be released when notes are held over', () => {
    const { machine, press, release, releaseAll } = setup()
    press(60, 64, 67)
    machine.promptShown(prompt(0, 'maj', 'any'))
    expect(machine.state.phase).toBe('awaiting-release')

    // Held-over notes are never judged — even a "correct" change is inert.
    release(67)
    press(67)
    expect(machine.state.phase).toBe('awaiting-release')

    releaseAll()
    expect(machine.state.phase).toBe('armed')
  })
})

describe('lifecycle — correct (§6.2 step 2)', () => {
  it('judges on every held-set change and reports reaction time', () => {
    const { machine, press } = setup()
    machine.promptShown(prompt(0, 'maj', 'any'))

    vi.advanceTimersByTime(1200) // thinking…
    press(60)
    press(64)
    expect(machine.state.phase).toBe('armed')
    press(67)
    expect(machine.state.phase).toBe('advancing')
    expect(machine.state.reactionMs).toBe(1200)
    expect(machine.state.hint).toBeNull()
  })

  it('asks the host to advance after the auto-advance delay', () => {
    const { machine, advances, press } = setup()
    machine.promptShown(prompt(0, 'maj', 'any'))
    press(60, 64, 67)

    vi.advanceTimersByTime(ADVANCE - 1)
    expect(advances).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(advances).toHaveLength(1)
  })

  it('ignores input during the advance window', () => {
    const { machine, press, releaseAll } = setup()
    machine.promptShown(prompt(0, 'maj', 'any'))
    press(60, 64, 67)
    releaseAll()
    press(35, 36, 37) // mashing — would be a definitive miss if judged
    expect(machine.state.phase).toBe('advancing')
    expect(machine.state.missCount).toBe(0)
  })

  it('reaction time spans prompt-shown → correct, retries included (§7)', () => {
    const { machine, press, releaseAll } = setup()
    machine.promptShown(prompt(0, 'maj', 'any'))

    vi.advanceTimersByTime(1000)
    press(61) // definitive miss
    releaseAll()
    vi.advanceTimersByTime(1000)
    press(60, 64, 67)
    expect(machine.state.reactionMs).toBe(2000)
  })
})

describe('lifecycle — definitive miss (§6.2 step 2)', () => {
  it('latches immediately on a non-chord pitch class', () => {
    const { machine, press } = setup()
    machine.promptShown(prompt(0, 'maj', 'any'))
    press(61)
    expect(machine.state.phase).toBe('missed')
    expect(machine.state.missCount).toBe(1)
    expect(machine.state.hint).toEqual({ kind: 'wrong-keys', notes: [61] })
  })

  it('latches immediately on violated doubling under exact', () => {
    const { machine, press } = setup()
    machine.promptShown(prompt(0, 'maj', 'closed'))
    press(60, 72)
    expect(machine.state.phase).toBe('missed')
    expect(machine.state.hint).toEqual({
      kind: 'constraint',
      text: 'Octave doubling not allowed',
    })
  })

  it('tolerates extra notes when strict extra notes is off', () => {
    const { machine, press } = setup({ strictExtraNotes: false })
    machine.promptShown(prompt(0, 'maj', 'any'))
    press(61, 60, 64, 67)
    expect(machine.state.phase).toBe('advancing') // matches leniently
  })
})

describe('lifecycle — stall miss (§6.2 step 2)', () => {
  it('misses a full-sized wrong set after the judgment delay', () => {
    const { machine, press } = setup()
    machine.promptShown(prompt(0, 'maj', 'first-inversion'))
    press(60, 64, 67) // root position in an inversion drill

    vi.advanceTimersByTime(STALL - 1)
    expect(machine.state.phase).toBe('armed')
    vi.advanceTimersByTime(1)
    expect(machine.state.phase).toBe('missed')
    expect(machine.state.hint).toEqual({
      kind: 'constraint',
      text: 'Bass must be the 3rd',
    })
  })

  it('restarts the stall clock on every held-set change', () => {
    const { machine, press } = setup()
    machine.promptShown(prompt(0, 'maj', 'first-inversion'))
    press(60, 64, 67)

    vi.advanceTimersByTime(STALL - 100)
    press(72) // still wrong bass, still extendable
    vi.advanceTimersByTime(STALL - 100)
    expect(machine.state.phase).toBe('armed')
    vi.advanceTimersByTime(100)
    expect(machine.state.phase).toBe('missed')
  })

  it('never stalls a set smaller than the chord', () => {
    const { machine, press } = setup()
    machine.promptShown(prompt(0, 'maj', 'any'))
    press(60, 64)
    vi.advanceTimersByTime(STALL * 20)
    expect(machine.state.phase).toBe('armed')
    expect(machine.state.missCount).toBe(0)
  })

  it('reads the judgment delay live from settings', () => {
    const { machine, settings, press } = setup()
    settings.judgmentDelayMs = 2000
    machine.promptShown(prompt(0, 'maj', 'first-inversion'))
    press(60, 64, 67)
    vi.advanceTimersByTime(STALL * 2)
    expect(machine.state.phase).toBe('armed')
    vi.advanceTimersByTime(1000)
    expect(machine.state.phase).toBe('missed')
  })
})

describe('lifecycle — silent abandon (§6.2 step 3)', () => {
  it('releasing all keys before judgment neither misses nor hints', () => {
    const { machine, press, releaseAll } = setup()
    machine.promptShown(prompt(0, 'maj', 'first-inversion'))
    press(60, 64, 67)
    vi.advanceTimersByTime(STALL - 100)
    releaseAll() // self-correction — cancels the pending stall

    vi.advanceTimersByTime(STALL * 20)
    expect(machine.state.phase).toBe('armed')
    expect(machine.state.missCount).toBe(0)
    expect(machine.state.hint).toBeNull()
  })

  it('an abandon after a miss does not advance the hint stage', () => {
    const { machine, press, releaseAll } = setup()
    machine.promptShown(prompt(0, 'maj', 'first-inversion'))
    press(60, 64, 67)
    vi.advanceTimersByTime(STALL)
    expect(machine.state.missCount).toBe(1)

    releaseAll()
    press(64) // partial retry…
    releaseAll() // …abandoned
    expect(machine.state.missCount).toBe(1)

    press(60, 64, 67)
    vi.advanceTimersByTime(STALL)
    expect(machine.state.missCount).toBe(2) // next real miss, not 3
  })
})

describe('lifecycle — retry until correct (§6.2 step 3)', () => {
  it('ignores further input while missed until all keys are released', () => {
    const { machine, press, releaseAll } = setup()
    machine.promptShown(prompt(0, 'maj', 'any'))
    press(61)
    expect(machine.state.phase).toBe('missed')

    press(60, 64, 67) // even completing the chord does not judge
    expect(machine.state.phase).toBe('missed')

    releaseAll()
    expect(machine.state.phase).toBe('armed')
    press(60, 64, 67)
    expect(machine.state.phase).toBe('advancing')
  })

  it('keeps the hint visible through the retry', () => {
    const { machine, press, releaseAll } = setup()
    machine.promptShown(prompt(0, 'maj', 'first-inversion'))
    press(60, 64, 67)
    vi.advanceTimersByTime(STALL)
    const hint = machine.state.hint
    expect(hint).not.toBeNull()

    releaseAll() // armed again — the player still needs the guidance
    expect(machine.state.phase).toBe('armed')
    expect(machine.state.hint).toEqual(hint)
  })

  it('escalates to the reveal on the 3rd miss (§6.4)', () => {
    const { machine, press, releaseAll } = setup()
    const p = prompt(0, 'maj', 'first-inversion')
    machine.promptShown(p)

    for (const expected of [1, 2, 3]) {
      press(60, 64, 67)
      vi.advanceTimersByTime(STALL)
      expect(machine.state.missCount).toBe(expected)
      expect(machine.state.hint?.kind).toBe(
        expected < 3 ? 'constraint' : 'reveal',
      )
      releaseAll()
    }
    expect(machine.state.hint).toEqual({ kind: 'reveal', notes: p.example })
  })
})

describe('lifecycle — skip (§6.2 step 4)', () => {
  it('asks the host to advance immediately', () => {
    const { machine, advances } = setup()
    machine.promptShown(prompt(0, 'maj', 'any'))
    machine.skip()
    expect(advances).toHaveLength(1)
    expect(machine.state.missCount).toBe(0)
  })

  it('works from the missed state', () => {
    const { machine, advances, press } = setup()
    machine.promptShown(prompt(0, 'maj', 'any'))
    press(61)
    machine.skip()
    expect(advances).toHaveLength(1)
  })

  it('cancels a pending stall so the old prompt cannot miss late', () => {
    const { machine, press } = setup()
    machine.promptShown(prompt(0, 'maj', 'first-inversion'))
    press(60, 64, 67)
    machine.skip()
    vi.advanceTimersByTime(STALL * 20)
    expect(machine.state.missCount).toBe(0)
  })

  it('is ignored while advancing (auto-advance already pending)', () => {
    const { machine, advances, press } = setup()
    machine.promptShown(prompt(0, 'maj', 'any'))
    press(60, 64, 67)
    machine.skip()
    machine.skip()
    expect(advances).toHaveLength(0) // only the timer advances
    vi.advanceTimersByTime(ADVANCE)
    expect(advances).toHaveLength(1)
  })
})

describe('lifecycle — next prompt resets per-prompt state', () => {
  it('clears miss count, hint, and reaction time', () => {
    const { machine, press, releaseAll } = setup()
    machine.promptShown(prompt(0, 'maj', 'any'))
    press(61)
    releaseAll()
    press(60, 64, 67)
    expect(machine.state.missCount).toBe(1)
    expect(machine.state.reactionMs).not.toBeNull()

    releaseAll()
    machine.promptShown(prompt(2, 'maj', 'any'))
    expect(machine.state).toEqual({
      phase: 'armed',
      reactionMs: null,
      missCount: 0,
      hint: null,
    })
  })

  it('emits every transition to the host', () => {
    const { machine, emitted, press, releaseAll } = setup()
    machine.promptShown(prompt(0, 'maj', 'any'))
    press(61) // miss
    releaseAll() // re-arm
    press(60, 64, 67) // correct
    expect(emitted.map((s) => s.phase)).toEqual([
      'armed',
      'missed',
      'armed',
      'advancing',
    ])
  })
})
