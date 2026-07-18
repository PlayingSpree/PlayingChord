import { describe, expect, it } from 'vitest'
import { primeOnFirstGesture, SharedAudioContext } from './context'

// A minimal structural fake of the Web Audio surface these tests touch.
// resume() deliberately does NOT flip state synchronously — real contexts
// stay 'suspended' until the returned promise settles, which is exactly the
// window playback must stay silent (never queue a late sound).

class FakeAudioContext {
  state: AudioContextState = 'running'
  resumeCalls = 0
  resume() {
    this.resumeCalls += 1
    return Promise.resolve()
  }
}

const asContext = (fake: FakeAudioContext) => fake as unknown as AudioContext

describe('SharedAudioContext', () => {
  it('creates the context once and reuses it', () => {
    const ctx = new FakeAudioContext()
    let created = 0
    const shared = new SharedAudioContext(() => {
      created += 1
      return asContext(ctx)
    })
    shared.prime()
    shared.running()
    shared.running()
    expect(created).toBe(1)
  })

  it('does nothing without Web Audio (factory yields null)', () => {
    const shared = new SharedAudioContext(() => null)
    expect(() => {
      shared.prime()
      expect(shared.running()).toBeNull()
    }).not.toThrow()
  })

  it('stays silent while the context is suspended, but asks it to resume', () => {
    const ctx = new FakeAudioContext()
    ctx.state = 'suspended'
    const shared = new SharedAudioContext(() => asContext(ctx))
    expect(shared.running()).toBeNull()
    expect(ctx.resumeCalls).toBe(1)
  })

  it('returns the context once running', () => {
    const ctx = new FakeAudioContext()
    const shared = new SharedAudioContext(() => asContext(ctx))
    expect(shared.running()).toBe(asContext(ctx))
  })
})

describe('primeOnFirstGesture', () => {
  it('primes on the first gesture and cleans its listeners up', () => {
    const ctx = new FakeAudioContext()
    ctx.state = 'suspended'
    const shared = new SharedAudioContext(() => asContext(ctx))
    const listeners = new Map<string, EventListener>()
    const target = {
      addEventListener: (type: string, fn: EventListener) => {
        listeners.set(type, fn)
      },
      removeEventListener: (type: string) => {
        listeners.delete(type)
      },
    } as unknown as Window

    const cleanup = primeOnFirstGesture(target, shared)
    expect([...listeners.keys()].sort()).toEqual(['keydown', 'pointerdown'])
    listeners.get('pointerdown')?.(new Event('pointerdown'))
    expect(ctx.resumeCalls).toBe(1)
    cleanup()
    expect(listeners.size).toBe(0)
  })
})
