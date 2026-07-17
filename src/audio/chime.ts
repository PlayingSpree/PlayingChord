// Web Audio correct-chime (DESIGN.md §9): the chime on ✔ is the app's only
// sound — misses are always visual-only. Playback is fire-and-forget so the
// ✔ flash never waits on audio (§6.2): a context that isn't running yet
// (autoplay policy still blocking) drops the chime instead of queueing a
// late one.

export type AudioContextFactory = () => AudioContext | null

const defaultFactory: AudioContextFactory = () =>
  typeof AudioContext === 'undefined' ? null : new AudioContext()

// Two quick sine partials — C6 then E6 — with a fast exponential decay: a
// short, bright "ding" that stays pleasant at drill tempo.
const PARTIALS = [
  { frequency: 1046.5, delay: 0, peak: 0.12, decaySeconds: 0.4 },
  { frequency: 1318.5, delay: 0.06, peak: 0.08, decaySeconds: 0.45 },
] as const

// Exponential ramps reject zero; this is −80 dB, i.e. silence.
const SILENT = 0.0001

export class Chime {
  private context: AudioContext | null = null
  private readonly create: AudioContextFactory

  constructor(create: AudioContextFactory = defaultFactory) {
    this.create = create
  }

  // Create/resume the context ahead of the first chime. Browsers unlock
  // audio only after a user gesture — and incoming MIDI doesn't count as
  // one — so the app primes on the first pointer/key event instead
  // (primeOnFirstGesture below). Safe to call any number of times.
  prime(): void {
    this.context ??= this.create()
    if (this.context?.state === 'suspended') void this.context.resume()
  }

  play(): void {
    this.prime()
    const ctx = this.context
    if (ctx === null || ctx.state !== 'running') return
    const start = ctx.currentTime
    for (const { frequency, delay, peak, decaySeconds } of PARTIALS) {
      const at = start + delay
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = frequency
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(SILENT, at)
      gain.gain.linearRampToValueAtTime(peak, at + 0.01)
      gain.gain.exponentialRampToValueAtTime(SILENT, at + decaySeconds)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(at)
      osc.stop(at + decaySeconds + 0.05)
    }
  }
}

// The app-wide instance; tests construct their own with a fake factory.
export const chime = new Chime()

// One-shot gesture hooks so the context is already running by the first
// correct match: pointer for mouse/touch users, keydown for the QWERTY sim.
// Both fire prime() (idempotent); returns a cleanup for React effects.
export function primeOnFirstGesture(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  instance: Chime = chime,
): () => void {
  const prime = () => instance.prime()
  target.addEventListener('pointerdown', prime, { once: true })
  target.addEventListener('keydown', prime, { once: true })
  return () => {
    target.removeEventListener('pointerdown', prime)
    target.removeEventListener('keydown', prime)
  }
}
