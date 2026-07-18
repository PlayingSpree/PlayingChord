// Web Audio metronome click for Song mode (DESIGN.md §6.5): one short tick
// per beat, beat 1 accented. Fire-and-forget like the chime — a context that
// isn't running yet (autoplay policy still blocking) drops the tick instead
// of queueing a late one; the visual beat pulse carries the tempo meanwhile.
import { sharedAudioContext, type SharedAudioContext } from './context'

// A brief high sine blip reads as a classic metronome click; the accent is
// higher and louder so the bar turn is felt without watching the screen.
const ACCENT = { frequency: 1800, peak: 0.2 } as const
const NORMAL = { frequency: 1200, peak: 0.1 } as const
const DECAY_SECONDS = 0.06

// Exponential ramps reject zero; this is −80 dB, i.e. silence.
const SILENT = 0.0001

export class Metronome {
  private readonly shared: SharedAudioContext

  constructor(shared: SharedAudioContext = sharedAudioContext) {
    this.shared = shared
  }

  tick(accented: boolean): void {
    const ctx = this.shared.running()
    if (ctx === null) return
    const { frequency, peak } = accented ? ACCENT : NORMAL
    const at = ctx.currentTime
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = frequency
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(SILENT, at)
    gain.gain.linearRampToValueAtTime(peak, at + 0.001)
    gain.gain.exponentialRampToValueAtTime(SILENT, at + DECAY_SECONDS)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(at)
    osc.stop(at + DECAY_SECONDS + 0.05)
  }
}

// The app-wide instance; tests construct their own with a fake context.
export const metronome = new Metronome()
