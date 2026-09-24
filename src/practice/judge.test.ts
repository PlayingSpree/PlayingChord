import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isRunPrompt, PromptJudge } from './judge'
import type { LifecycleState } from './lifecycle'
import { createPrompt } from './prompts'
import { DEFAULT_PRACTICE_SETTINGS } from './settings'

const ADVANCE = DEFAULT_PRACTICE_SETTINGS.autoAdvanceMs
const C_UP = [60, 62, 64, 65, 67, 69, 71, 72]

const chord = () => createPrompt({ root: 0, typeId: 'maj', voicingId: 'any' })
const run = () =>
  createPrompt({
    kind: 'scale',
    root: 0,
    scaleTypeId: 'major',
    shapeId: 'up-1',
  })
const block = () =>
  createPrompt({
    kind: 'scale',
    root: 0,
    scaleTypeId: 'major',
    shapeId: 'block',
  })

function setup() {
  const advances: number[] = []
  const emitted: LifecycleState[] = []
  const judge = new PromptJudge({
    settings: () => DEFAULT_PRACTICE_SETTINGS,
    now: () => Date.now(),
    onState: (state) => emitted.push(state),
    onAdvance: () => advances.push(Date.now()),
  })
  let held = new Set<number>()
  const press = (...notes: number[]) => {
    held = new Set([...held, ...notes])
    judge.heldChange(held)
  }
  const release = (...notes: number[]) => {
    held = new Set([...held].filter((n) => !notes.includes(n)))
    judge.heldChange(held)
  }
  const play = (...notes: number[]) => {
    for (const note of notes) {
      press(note)
      release(note)
    }
  }
  return { judge, advances, emitted, press, release, play }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PromptJudge — picking the machine (§6.2, §6.6)', () => {
  it('runs only the run shapes as sequences', () => {
    expect(isRunPrompt(run())).toBe(true)
    expect(isRunPrompt(block())).toBe(false)
    expect(isRunPrompt(chord())).toBe(false)
  })

  it('judges a run note by note', () => {
    const { judge, play } = setup()
    judge.promptShown(run())
    play(...C_UP)
    expect(judge.state.phase).toBe('advancing')
  })

  it('judges chords and blocks as held sets', () => {
    const { judge, press, release } = setup()
    judge.promptShown(chord())
    press(60, 64, 67)
    expect(judge.state.phase).toBe('advancing')
    release(60, 64, 67)
    judge.promptShown(block())
    press(60, 62, 64, 65, 67, 69, 71)
    expect(judge.state.phase).toBe('advancing')
    expect(judge.state.run).toBeNull()
  })
})

describe('PromptJudge — switching machines', () => {
  it('keeps held keys across a switch, so a chord still waits for release', () => {
    const { judge, press, play } = setup()
    judge.promptShown(run())
    play(...C_UP.slice(0, -1))
    press(72) // the run's last note, still held
    judge.promptShown(chord())
    expect(judge.state.phase).toBe('awaiting-release')
  })

  it('never lets the outgoing machine speak for the new prompt', () => {
    const { judge, emitted, advances, play } = setup()
    judge.promptShown(run())
    play(...C_UP) // ✔, advance timer pending on the run machine
    const before = emitted.length
    judge.promptShown(chord()) // the host moved on early
    // One emission, the chord's arming — not the run machine's reset.
    expect(emitted.slice(before).map((s) => s.phase)).toEqual(['armed'])
    vi.advanceTimersByTime(ADVANCE)
    expect(advances).toHaveLength(0)
  })

  it('stops whichever machine is live', () => {
    const { judge, emitted, play } = setup()
    judge.promptShown(run())
    play(60)
    judge.stop()
    expect(judge.state.phase).toBe('idle')
    expect(emitted.at(-1)?.run).toBeNull()
  })
})
