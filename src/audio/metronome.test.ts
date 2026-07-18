import { describe, expect, it } from 'vitest'
import { SharedAudioContext } from './context'
import { Metronome } from './metronome'

// A minimal structural fake of the Web Audio surface the metronome touches.

class FakeParam {
  value = 0
  events: Array<{ kind: string; value: number; at: number }> = []
  setValueAtTime(value: number, at: number) {
    this.events.push({ kind: 'set', value, at })
  }
  linearRampToValueAtTime(value: number, at: number) {
    this.events.push({ kind: 'linear', value, at })
  }
  exponentialRampToValueAtTime(value: number, at: number) {
    this.events.push({ kind: 'exp', value, at })
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
  currentTime = 2.5
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

function metronomeOn(ctx: FakeAudioContext): Metronome {
  return new Metronome(new SharedAudioContext(() => asContext(ctx)))
}

describe('Metronome', () => {
  it('ticks one short oscillator at currentTime and stops it', () => {
    const ctx = new FakeAudioContext()
    metronomeOn(ctx).tick(false)
    expect(ctx.oscillators).toHaveLength(1)
    const osc = ctx.oscillators[0]!
    expect(osc.type).toBe('sine')
    expect(osc.startedAt).toEqual([2.5])
    expect(osc.stoppedAt[0]).toBeGreaterThan(2.5)
    expect(osc.stoppedAt[0]).toBeLessThan(2.5 + 0.5)
  })

  it('accents beat 1 with a higher, louder click', () => {
    const ctx = new FakeAudioContext()
    const metronome = metronomeOn(ctx)
    metronome.tick(true)
    metronome.tick(false)
    const [accent, normal] = ctx.oscillators
    expect(accent!.frequency.value).toBeGreaterThan(normal!.frequency.value)
    const peakOf = (gain: FakeGain) =>
      gain.gain.events.find((e) => e.kind === 'linear')!.value
    const [accentGain, normalGain] = ctx.gains
    expect(peakOf(accentGain!)).toBeGreaterThan(peakOf(normalGain!))
  })

  it('stays silent while the context is suspended, but asks it to resume', () => {
    const ctx = new FakeAudioContext()
    ctx.state = 'suspended'
    metronomeOn(ctx).tick(true)
    expect(ctx.oscillators).toHaveLength(0)
    expect(ctx.resumeCalls).toBe(1)
  })

  it('does nothing without Web Audio (factory yields null)', () => {
    const metronome = new Metronome(new SharedAudioContext(() => null))
    expect(() => metronome.tick(true)).not.toThrow()
  })
})
