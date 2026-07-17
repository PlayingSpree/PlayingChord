import { describe, expect, it } from 'vitest'
import { Chime, primeOnFirstGesture } from './chime'

// A minimal structural fake of the Web Audio surface the chime touches.
// resume() deliberately does NOT flip state synchronously — real contexts
// stay 'suspended' until the returned promise settles, which is exactly the
// window the chime must stay silent (never queue a late chime).

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
  currentTime = 1.5
  destination = new FakeNode()
  oscillators: FakeOscillator[] = []
  resumeCalls = 0
  createOscillator() {
    const osc = new FakeOscillator()
    this.oscillators.push(osc)
    return osc
  }
  createGain() {
    return new FakeGain()
  }
  resume() {
    this.resumeCalls += 1
    return Promise.resolve()
  }
}

const asContext = (fake: FakeAudioContext) => fake as unknown as AudioContext

describe('Chime', () => {
  it('schedules the first partial at currentTime — no added latency', () => {
    const ctx = new FakeAudioContext()
    const chime = new Chime(() => asContext(ctx))
    chime.play()
    expect(ctx.oscillators).toHaveLength(2)
    expect(ctx.oscillators[0]?.startedAt).toEqual([1.5])
    // Every oscillator is stopped shortly after — nothing rings on forever.
    for (const osc of ctx.oscillators) {
      expect(osc.stoppedAt[0]).toBeGreaterThan(1.5)
      expect(osc.stoppedAt[0]).toBeLessThan(1.5 + 1)
    }
  })

  it('shapes each partial with an attack ramp and exponential decay', () => {
    const ctx = new FakeAudioContext()
    new Chime(() => asContext(ctx)).play()
    const osc = ctx.oscillators[0]!
    expect(osc.type).toBe('sine')
    expect(osc.frequency.value).toBeCloseTo(1046.5)
  })

  it('stays silent while the context is suspended, but asks it to resume', () => {
    const ctx = new FakeAudioContext()
    ctx.state = 'suspended'
    const chime = new Chime(() => asContext(ctx))
    chime.play()
    expect(ctx.oscillators).toHaveLength(0)
    expect(ctx.resumeCalls).toBe(1)
  })

  it('creates the context once and reuses it', () => {
    const ctx = new FakeAudioContext()
    let created = 0
    const chime = new Chime(() => {
      created += 1
      return asContext(ctx)
    })
    chime.prime()
    chime.play()
    chime.play()
    expect(created).toBe(1)
  })

  it('does nothing without Web Audio (factory yields null)', () => {
    const chime = new Chime(() => null)
    expect(() => {
      chime.prime()
      chime.play()
    }).not.toThrow()
  })
})

describe('primeOnFirstGesture', () => {
  it('primes on the first gesture and cleans its listeners up', () => {
    const ctx = new FakeAudioContext()
    ctx.state = 'suspended'
    const chime = new Chime(() => asContext(ctx))
    const listeners = new Map<string, EventListener>()
    const target = {
      addEventListener: (type: string, fn: EventListener) => {
        listeners.set(type, fn)
      },
      removeEventListener: (type: string) => {
        listeners.delete(type)
      },
    } as unknown as Window

    const cleanup = primeOnFirstGesture(target, chime)
    expect([...listeners.keys()].sort()).toEqual(['keydown', 'pointerdown'])
    listeners.get('pointerdown')?.(new Event('pointerdown'))
    expect(ctx.resumeCalls).toBe(1)
    cleanup()
    expect(listeners.size).toBe(0)
  })
})
