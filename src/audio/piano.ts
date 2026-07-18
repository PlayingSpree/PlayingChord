// Web Audio piano synth (DESIGN.md §9): voices the user's own key presses,
// velocity-sensitive — this is the player's own sound, not feedback, so
// misses stay visual-only regardless of this setting.
import { sharedAudioContext, type SharedAudioContext } from './context'

// Exponential ramps reject zero; this is −80 dB, i.e. silence.
const SILENT = 0.0001

const ATTACK_SECONDS = 0.008
const SUSTAIN_SECONDS = 1.2
const SUSTAIN_LEVEL = 0.25 // fraction of peak, held while the key is down
const NATURAL_DECAY_SECONDS = 6 // fade if noteOff never arrives (e.g. hung MIDI)
const RELEASE_SECONDS = 0.25

// A simple piano-ish patch: fundamental (triangle) plus two upper partials
// (sine), gains normalized to sum to 1 so `peak` below is the note's actual
// ceiling — not inflated by the harmonic stack.
const HARMONICS: ReadonlyArray<{
  multiple: number
  type: OscillatorType
  gain: number
}> = [
  { multiple: 1, type: 'triangle', gain: 0.65 },
  { multiple: 2, type: 'sine', gain: 0.25 },
  { multiple: 3, type: 'sine', gain: 0.1 },
]

// A0=440*2^((21-69)/12); standard MIDI note-number-to-frequency formula.
function frequencyOf(note: number): number {
  return 440 * 2 ** ((note - 69) / 12)
}

interface Voice {
  oscillators: OscillatorNode[]
  gain: GainNode
}

export class Piano {
  private readonly shared: SharedAudioContext
  private master: GainNode | null = null
  private readonly voices = new Map<number, Voice>()

  constructor(shared: SharedAudioContext = sharedAudioContext) {
    this.shared = shared
  }

  // Lazy, created once against whichever context is currently running —
  // caps the summed loudness of many simultaneous held notes.
  private masterGain(ctx: AudioContext): GainNode {
    if (this.master === null) {
      this.master = ctx.createGain()
      this.master.gain.value = 0.5
      this.master.connect(ctx.destination)
    }
    return this.master
  }

  noteOn(note: number, velocity: number): void {
    const ctx = this.shared.running()
    if (ctx === null) return
    this.release(note, ctx) // a retrigger on a held note replaces its voice

    const now = ctx.currentTime
    const peak = 0.03 + 0.15 * (velocity / 127)
    const envelope = ctx.createGain()
    envelope.gain.setValueAtTime(SILENT, now)
    envelope.gain.linearRampToValueAtTime(peak, now + ATTACK_SECONDS)
    envelope.gain.exponentialRampToValueAtTime(
      peak * SUSTAIN_LEVEL,
      now + SUSTAIN_SECONDS,
    )
    envelope.gain.exponentialRampToValueAtTime(
      SILENT,
      now + NATURAL_DECAY_SECONDS,
    )
    envelope.connect(this.masterGain(ctx))

    const frequency = frequencyOf(note)
    const oscillators = HARMONICS.map(({ multiple, type, gain }) => {
      const osc = ctx.createOscillator()
      osc.type = type
      osc.frequency.value = frequency * multiple
      const harmonicGain = ctx.createGain()
      harmonicGain.gain.value = gain
      osc.connect(harmonicGain)
      harmonicGain.connect(envelope)
      osc.start(now)
      return osc
    })

    this.voices.set(note, { oscillators, gain: envelope })
  }

  noteOff(note: number): void {
    const ctx = this.shared.running()
    if (ctx === null) return
    this.release(note, ctx)
  }

  allNotesOff(): void {
    const ctx = this.shared.running()
    if (ctx === null) return
    for (const note of [...this.voices.keys()]) this.release(note, ctx)
  }

  private release(note: number, ctx: AudioContext): void {
    const voice = this.voices.get(note)
    if (!voice) return
    this.voices.delete(note)
    const now = ctx.currentTime
    // Pin the envelope's current value before ramping down — an
    // exponential ramp needs an explicit starting point, and
    // cancelScheduledValues alone doesn't give it one.
    voice.gain.gain.cancelScheduledValues(now)
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now)
    voice.gain.gain.exponentialRampToValueAtTime(SILENT, now + RELEASE_SECONDS)
    for (const osc of voice.oscillators) {
      osc.stop(now + RELEASE_SECONDS + 0.05)
    }
  }
}

// The app-wide instance; tests construct their own with a fake context.
export const piano = new Piano()
