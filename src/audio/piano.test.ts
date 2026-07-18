import { describe, expect, it } from 'vitest'
import { Piano } from './piano'
import { SharedAudioContext } from './context'

// A minimal structural fake of the Web Audio surface the piano touches.

class FakeParam {
  value = 0
  events: Array<{ kind: string; value: number; at: number }> = []
  setValueAtTime(value: number, at: number) {
    this.value = value
    this.events.push({ kind: 'set', value, at })
  }
  linearRampToValueAtTime(value: number, at: number) {
    this.value = value
    this.events.push({ kind: 'linear', value, at })
  }
  exponentialRampToValueAtTime(value: number, at: number) {
    this.value = value
    this.events.push({ kind: 'exp', value, at })
  }
  cancelScheduledValues(at: number) {
    this.events.push({ kind: 'cancel', value: 0, at })
  }
}

class FakeNode {
  connect(node: unknown) {
    return node
  }
}

class FakeOscillator extends FakeNode {
  type = ''
  frequency = new FakeParam()
  startedAt: number[] = []
  stoppedAt: number[] = []
  start(at: number) {
    this.startedAt.push(at)
  }
  stop(at: number) {
    this.stoppedAt.push(at)
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam()
}

class FakeAudioContext {
  state: AudioContextState = 'running'
  currentTime = 2
  destination = new FakeNode()
  oscillators: FakeOscillator[] = []
  gains: FakeGain[] = []
  resumeCalls = 0
  createOscillator() {
    const osc = new FakeOscillator()
    this.oscillators.push(osc)
    return osc
  }
  createGain() {
    const gain = new FakeGain()
    this.gains.push(gain)
    return gain
  }
  resume() {
    this.resumeCalls += 1
    return Promise.resolve()
  }
}

const asContext = (fake: FakeAudioContext) => fake as unknown as AudioContext

function pianoOn(ctx: FakeAudioContext): Piano {
  return new Piano(new SharedAudioContext(() => asContext(ctx)))
}

describe('Piano', () => {
  it('noteOn schedules 3 harmonics at the fundamental, 2×, and 3×', () => {
    const ctx = new FakeAudioContext()
    pianoOn(ctx).noteOn(69, 127) // A4 = 440Hz
    expect(ctx.oscillators).toHaveLength(3)
    const freqs = ctx.oscillators
      .map((o) => o.frequency.value)
      .sort((a, b) => a - b)
    expect(freqs[0]).toBeCloseTo(440)
    expect(freqs[1]).toBeCloseTo(880)
    expect(freqs[2]).toBeCloseTo(1320)
  })

  it('schedules an attack ramp on noteOn', () => {
    const ctx = new FakeAudioContext()
    pianoOn(ctx).noteOn(60, 100)
    // One envelope gain plus one gain per harmonic (3).
    const envelope = ctx.gains[0]!
    expect(envelope.gain.events[0]?.kind).toBe('set')
    expect(envelope.gain.events[1]?.kind).toBe('linear')
  })

  it('higher velocity produces a higher peak than lower velocity', () => {
    const soft = new FakeAudioContext()
    pianoOn(soft).noteOn(60, 1)
    const softPeak = soft.gains[0]!.gain.events[1]!.value

    const loud = new FakeAudioContext()
    pianoOn(loud).noteOn(60, 127)
    const loudPeak = loud.gains[0]!.gain.events[1]!.value

    expect(loudPeak).toBeGreaterThan(softPeak)
  })

  it('noteOff schedules a release and stops the oscillators', () => {
    const ctx = new FakeAudioContext()
    const piano = pianoOn(ctx)
    piano.noteOn(60, 100)
    piano.noteOff(60)

    const envelope = ctx.gains[0]!
    expect(envelope.gain.events.some((e) => e.kind === 'cancel')).toBe(true)
    expect(envelope.gain.events.at(-1)?.kind).toBe('exp')
    for (const osc of ctx.oscillators) {
      expect(osc.stoppedAt).toHaveLength(1)
      expect(osc.stoppedAt[0]).toBeGreaterThan(ctx.currentTime)
    }
  })

  it('a second noteOff for the same note is a no-op', () => {
    const ctx = new FakeAudioContext()
    const piano = pianoOn(ctx)
    piano.noteOn(60, 100)
    piano.noteOff(60)
    const stopCallsAfterFirst = ctx.oscillators.map((o) => o.stoppedAt.length)
    piano.noteOff(60)
    const stopCallsAfterSecond = ctx.oscillators.map((o) => o.stoppedAt.length)
    expect(stopCallsAfterSecond).toEqual(stopCallsAfterFirst)
  })

  it('retriggering a held note releases the old voice and starts one new one', () => {
    const ctx = new FakeAudioContext()
    const piano = pianoOn(ctx)
    piano.noteOn(60, 100)
    piano.noteOn(60, 100)
    // 3 harmonics per voice, 2 voices created (old released on retrigger).
    expect(ctx.oscillators).toHaveLength(6)
    expect(
      ctx.oscillators.slice(0, 3).every((o) => o.stoppedAt.length === 1),
    ).toBe(true)
    expect(
      ctx.oscillators.slice(3).every((o) => o.stoppedAt.length === 0),
    ).toBe(true)
  })

  it('allNotesOff releases every held voice', () => {
    const ctx = new FakeAudioContext()
    const piano = pianoOn(ctx)
    piano.noteOn(60, 100)
    piano.noteOn(64, 100)
    piano.noteOn(67, 100)
    piano.allNotesOff()
    expect(ctx.oscillators.every((o) => o.stoppedAt.length === 1)).toBe(true)
  })

  it('stays silent while the context is suspended, but asks it to resume', () => {
    const ctx = new FakeAudioContext()
    ctx.state = 'suspended'
    pianoOn(ctx).noteOn(60, 100)
    expect(ctx.oscillators).toHaveLength(0)
    expect(ctx.resumeCalls).toBe(1)
  })

  it('creates the master gain once and reuses it across notes', () => {
    const ctx = new FakeAudioContext()
    const piano = pianoOn(ctx)
    piano.noteOn(60, 100)
    piano.noteOn(64, 100)
    // 2 envelopes + 6 harmonic gains + 1 shared master = 9.
    expect(ctx.gains).toHaveLength(9)
  })
})
