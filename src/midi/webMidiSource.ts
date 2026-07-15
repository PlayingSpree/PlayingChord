import { createEmitter } from './emitter'
import { parseMidiMessage } from './parseMessage'
import type {
  MidiDeviceInfo,
  MidiEvent,
  MidiSource,
  MidiSupport,
} from './types'

export class WebMidiSource implements MidiSource {
  private access: MIDIAccess | null = null
  private activeId: string | null = null
  private emitter = createEmitter<MidiEvent>()

  async init(): Promise<MidiSupport> {
    if (
      typeof navigator === 'undefined' ||
      !('requestMIDIAccess' in navigator)
    ) {
      return 'unsupported'
    }
    try {
      this.access = await navigator.requestMIDIAccess()
    } catch {
      return 'denied'
    }
    this.access.onstatechange = () => {
      this.attachInputs()
      this.emitter.emit({ kind: 'devicesChanged', devices: this.devices() })
    }
    this.attachInputs()
    return 'ok'
  }

  devices(): MidiDeviceInfo[] {
    if (!this.access) return []
    return [...this.access.inputs.values()].map((input) => ({
      id: input.id,
      name: input.name ?? 'MIDI device',
    }))
  }

  setActiveDevice(id: string | null): void {
    this.activeId = id
  }

  subscribe(listener: (event: MidiEvent) => void): () => void {
    return this.emitter.subscribe(listener)
  }

  // Handlers go on every input and filter by active id at message time —
  // unplug/replug replaces MIDIInput instances, so per-input attach/detach
  // bookkeeping is fragile.
  private attachInputs(): void {
    if (!this.access) return
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (event) => {
        if (input.id !== this.activeId) return
        const parsed = parseMidiMessage(event.data)
        if (parsed) this.emitter.emit(parsed)
      }
    }
  }
}
