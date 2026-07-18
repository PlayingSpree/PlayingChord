// Web Audio correct-chime (DESIGN.md §9): plays on ✔, independent of the
// key-press piano sound. Playback is fire-and-forget so the ✔ flash never
// waits on audio (§6.2): a context that isn't running yet (autoplay policy
// still blocking) drops the chime instead of queueing a late one.
import { sharedAudioContext, type SharedAudioContext } from './context'

// Two quick sine partials — C6 then E6 — with a fast exponential decay: a
// short, bright "ding" that stays pleasant at drill tempo.
const PARTIALS = [
  { frequency: 1046.5, delay: 0, peak: 0.12, decaySeconds: 0.4 },
  { frequency: 1318.5, delay: 0.06, peak: 0.08, decaySeconds: 0.45 },
] as const

// Exponential ramps reject zero; this is −80 dB, i.e. silence.
const SILENT = 0.0001

export class Chime {
  private readonly shared: SharedAudioContext

  constructor(shared: SharedAudioContext = sharedAudioContext) {
    this.shared = shared
  }

  play(): void {
    const ctx = this.shared.running()
    if (ctx === null) return
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

// The app-wide instance; tests construct their own with a fake context.
export const chime = new Chime()
