// Shared Web Audio context (DESIGN.md §9): the chime and the key-press piano
// both play through one AudioContext, so there's a single autoplay-unlock
// state and a single priming path for both instruments.

export type AudioContextFactory = () => AudioContext | null

const defaultFactory: AudioContextFactory = () =>
  typeof AudioContext === 'undefined' ? null : new AudioContext()

export class SharedAudioContext {
  private context: AudioContext | null = null
  private readonly create: AudioContextFactory

  constructor(create: AudioContextFactory = defaultFactory) {
    this.create = create
  }

  // Create/resume the context ahead of the first sound. Browsers unlock
  // audio only after a user gesture — and incoming MIDI doesn't count as
  // one — so the app primes on the first pointer/key event instead
  // (primeOnFirstGesture below). Safe to call any number of times.
  prime(): void {
    this.context ??= this.create()
    if (this.context?.state === 'suspended') void this.context.resume()
  }

  // The context, but only once it's actually running — callers drop the
  // sound instead of queueing it for later.
  running(): AudioContext | null {
    this.prime()
    return this.context?.state === 'running' ? this.context : null
  }
}

// The app-wide instance; tests construct their own.
export const sharedAudioContext = new SharedAudioContext()

// One-shot gesture hooks so the context is already running by the first
// correct match or key press: pointer for mouse/touch users, keydown for the
// QWERTY sim. Both fire prime() (idempotent); returns a cleanup for React
// effects.
export function primeOnFirstGesture(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  instance: { prime(): void } = sharedAudioContext,
): () => void {
  const prime = () => instance.prime()
  target.addEventListener('pointerdown', prime, { once: true })
  target.addEventListener('keydown', prime, { once: true })
  return () => {
    target.removeEventListener('pointerdown', prime)
    target.removeEventListener('keydown', prime)
  }
}
