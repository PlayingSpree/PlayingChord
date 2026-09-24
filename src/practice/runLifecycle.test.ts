import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScaleShapeId } from '../theory'
import type { LifecycleState } from './lifecycle'
import { createPrompt } from './prompts'
import { RunLifecycle } from './runLifecycle'
import { DEFAULT_PRACTICE_SETTINGS } from './settings'

// MIDI shorthand: C4=60 D4=62 E4=64 F4=65 G4=67 A4=69 B4=71 C5=72
const C_UP = [60, 62, 64, 65, 67, 69, 71, 72]
const ADVANCE = DEFAULT_PRACTICE_SETTINGS.autoAdvanceMs

const cMajor = (shapeId: ScaleShapeId) =>
  createPrompt({ kind: 'scale', root: 0, scaleTypeId: 'major', shapeId })

function setup(revealOnMisses?: () => boolean) {
  const advances: number[] = []
  const emitted: LifecycleState[] = []
  const machine = new RunLifecycle({
    settings: () => DEFAULT_PRACTICE_SETTINGS,
    now: () => Date.now(), // driven by fake timers
    onState: (state) => emitted.push(state),
    onAdvance: () => advances.push(Date.now()),
    revealOnMisses,
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
  // A detached run: each key down and up in turn.
  const play = (...notes: number[]) => {
    for (const note of notes) {
      press(note)
      release(note)
    }
  }
  return { machine, advances, emitted, press, release, play }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('run lifecycle — a clean run (§6.6)', () => {
  it('arms at once and waits on the root', () => {
    const { machine } = setup()
    machine.promptShown(cMajor('up-1'))
    expect(machine.state.phase).toBe('armed')
    expect(machine.state.run).toEqual({ notes: C_UP, played: 0 })
  })

  it('is correct on the last note, timed from the prompt', () => {
    const { machine, play } = setup()
    machine.promptShown(cMajor('up-1'))
    vi.advanceTimersByTime(3000)
    play(...C_UP.slice(0, -1))
    expect(machine.state.phase).toBe('armed')
    expect(machine.state.run?.played).toBe(7)
    play(72)
    expect(machine.state.phase).toBe('advancing')
    expect(machine.state.reactionMs).toBe(3000)
    expect(machine.state.missCount).toBe(0)
  })

  it('advances after the auto-advance delay and ignores notes meanwhile', () => {
    const { machine, advances, play } = setup()
    machine.promptShown(cMajor('up-1'))
    play(...C_UP)
    play(61, 63) // would be misses if judged
    expect(machine.state.missCount).toBe(0)
    vi.advanceTimersByTime(ADVANCE)
    expect(advances).toHaveLength(1)
  })

  it('plays up-and-down with the top note once', () => {
    const { machine, play } = setup()
    machine.promptShown(cMajor('updown-1'))
    play(...C_UP)
    expect(machine.state.phase).toBe('armed')
    play(...C_UP.slice(0, -1).reverse())
    expect(machine.state.phase).toBe('advancing')
  })

  it('fixes the octave on the first note', () => {
    const { machine, play } = setup()
    machine.promptShown(cMajor('up-1'))
    play(48) // C3
    expect(machine.state.run?.notes).toEqual(C_UP.map((n) => n - 12))
    play(...C_UP.slice(1).map((n) => n - 12))
    expect(machine.state.phase).toBe('advancing')
  })

  it('takes legato and overlapping notes', () => {
    const { machine, press, release } = setup()
    machine.promptShown(cMajor('up-1'))
    press(60)
    press(62) // 60 still down
    release(60)
    press(64, 65) // two keys in one change, low first
    release(62, 64, 65)
    press(67)
    press(69)
    press(71)
    press(72)
    expect(machine.state.phase).toBe('advancing')
    expect(machine.state.missCount).toBe(0)
  })

  it('never judges a release or a key held over from before', () => {
    const { machine, press, release, play } = setup()
    press(60) // e.g. the note that answered the Ready panel
    machine.promptShown(cMajor('up-1'))
    release(60)
    expect(machine.state.run?.played).toBe(0)
    play(...C_UP)
    expect(machine.state.phase).toBe('advancing')
  })
})

describe('run lifecycle — misses (§6.6)', () => {
  it('misses a wrong first note and waits for the root', () => {
    const { machine, play } = setup()
    machine.promptShown(cMajor('up-1'))
    play(62)
    expect(machine.state.phase).toBe('missed')
    expect(machine.state.missCount).toBe(1)
    expect(machine.state.hint).toEqual({ kind: 'wrong-keys', notes: [62] })
    play(...C_UP)
    expect(machine.state.phase).toBe('advancing')
    expect(machine.state.missCount).toBe(1)
  })

  it('waits on the expected note and keeps what came before', () => {
    const { machine, play } = setup()
    machine.promptShown(cMajor('up-1'))
    play(60, 62, 64)
    play(66) // F♯ for F
    expect(machine.state.phase).toBe('missed')
    expect(machine.state.run?.played).toBe(3)
    play(65)
    expect(machine.state.phase).toBe('armed')
    expect(machine.state.hint).toBeNull()
    play(67, 69, 71, 72)
    expect(machine.state.phase).toBe('advancing')
    expect(machine.state.missCount).toBe(1)
  })

  it('counts a fumble at one position as one miss', () => {
    const { machine, play } = setup()
    machine.promptShown(cMajor('up-1'))
    play(60, 62, 64)
    play(66, 63, 66)
    expect(machine.state.missCount).toBe(1)
    expect(machine.state.hint).toEqual({ kind: 'wrong-keys', notes: [63, 66] })
    play(65, 68) // right, then wrong at the next position
    expect(machine.state.missCount).toBe(2)
  })

  it('treats the root in another octave mid-run as a miss', () => {
    const { machine, play } = setup()
    machine.promptShown(cMajor('up-1'))
    play(60, 62)
    play(48)
    expect(machine.state.phase).toBe('missed')
  })

  it('keeps the clock running through misses', () => {
    const { machine, play } = setup()
    machine.promptShown(cMajor('up-1'))
    play(61)
    vi.advanceTimersByTime(4000)
    play(...C_UP)
    expect(machine.state.reactionMs).toBe(4000)
  })

  it('never stalls', () => {
    const { machine, play } = setup()
    machine.promptShown(cMajor('up-1'))
    play(60, 62)
    vi.advanceTimersByTime(60_000)
    expect(machine.state.phase).toBe('armed')
    expect(machine.state.missCount).toBe(0)
  })
})

describe('run lifecycle — starting over (§6.6)', () => {
  it('restarts on the starting note with no miss, the clock running', () => {
    const { machine, play } = setup()
    machine.promptShown(cMajor('up-1'))
    play(60, 62, 64)
    vi.advanceTimersByTime(1000)
    play(60)
    expect(machine.state.run?.played).toBe(1)
    expect(machine.state.missCount).toBe(0)
    play(...C_UP.slice(1))
    expect(machine.state.phase).toBe('advancing')
    expect(machine.state.reactionMs).toBe(1000)
  })

  it('recovers from a slip without a further miss', () => {
    const { machine, play } = setup()
    machine.promptShown(cMajor('up-1'))
    play(60, 62, 63)
    play(60)
    expect(machine.state.phase).toBe('armed')
    expect(machine.state.hint).toBeNull()
    play(...C_UP.slice(1))
    expect(machine.state.missCount).toBe(1)
  })

  it('reads the starting note at the end of up-and-down as the last note', () => {
    const { machine, play } = setup()
    machine.promptShown(cMajor('updown-1'))
    play(...C_UP, ...C_UP.slice(1, -1).reverse())
    expect(machine.state.run?.played).toBe(14)
    play(60)
    expect(machine.state.phase).toBe('advancing')
  })

  it('only restarts on the exact note, not its octave', () => {
    const { machine, play } = setup()
    machine.promptShown(cMajor('up-2'))
    play(48, 50, 52, 53, 55, 57, 59, 60) // C3 … C4, the octave passed
    play(62)
    expect(machine.state.run?.played).toBe(9)
    play(48)
    expect(machine.state.run?.played).toBe(1)
  })
})

describe('run lifecycle — hints (§6.4)', () => {
  it('overlays the rest of the run from miss 3, following it along', () => {
    const { machine, play } = setup()
    machine.promptShown(cMajor('up-1'))
    play(61) // miss 1, position 0
    play(60, 63) // miss 2, position 1
    play(62, 66) // miss 3, position 2
    expect(machine.state.hint).toEqual({
      kind: 'reveal',
      notes: [64, 65, 67, 69, 71, 72],
    })
    play(64)
    expect(machine.state.hint).toEqual({
      kind: 'reveal',
      notes: [65, 67, 69, 71, 72],
    })
  })

  it('never reveals where the host shows the answer already (Learn)', () => {
    const { machine, play } = setup(() => false)
    machine.promptShown(cMajor('up-1'))
    play(61)
    play(60, 63)
    play(62, 66)
    expect(machine.state.missCount).toBe(3)
    expect(machine.state.hint).toEqual({ kind: 'wrong-keys', notes: [66] })
  })

  it('reports progress without previewing the next note', () => {
    const { machine, play } = setup()
    machine.promptShown(cMajor('up-1'))
    play(60, 62)
    expect(machine.state.run).toEqual({ notes: C_UP, played: 2 })
    expect(machine.state.hint).toBeNull()
  })
})

describe('run lifecycle — stop', () => {
  it('goes idle and kills the advance timer', () => {
    const { machine, advances, play } = setup()
    machine.promptShown(cMajor('up-1'))
    play(...C_UP)
    machine.stop()
    expect(machine.state).toEqual({
      phase: 'idle',
      reactionMs: null,
      missCount: 0,
      hint: null,
      run: null,
    })
    vi.advanceTimersByTime(ADVANCE)
    expect(advances).toHaveLength(0)
  })
})
