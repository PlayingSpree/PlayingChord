import { createEmitter } from './emitter'
import type {
  MidiDeviceInfo,
  MidiEvent,
  MidiSource,
  MidiSupport,
} from './types'

// Programmatic MidiSource for tests and hardware-free development
// (DESIGN.md §6.1). Mirrors the real source's semantics: note events are
// only emitted while a device is active.
export class SimulatedMidiSource implements MidiSource {
  private connected: MidiDeviceInfo[]
  private activeId: string | null = null
  private emitter = createEmitter<MidiEvent>()

  constructor(initialDevices: MidiDeviceInfo[] = []) {
    this.connected = [...initialDevices]
  }

  init(): Promise<MidiSupport> {
    return Promise.resolve('ok')
  }

  devices(): MidiDeviceInfo[] {
    return [...this.connected]
  }

  setActiveDevice(id: string | null): void {
    this.activeId = id
  }

  subscribe(listener: (event: MidiEvent) => void): () => void {
    return this.emitter.subscribe(listener)
  }

  connect(device: MidiDeviceInfo): void {
    this.connected = [
      ...this.connected.filter((d) => d.id !== device.id),
      device,
    ]
    this.emitter.emit({ kind: 'devicesChanged', devices: this.devices() })
  }

  disconnect(id: string): void {
    this.connected = this.connected.filter((d) => d.id !== id)
    this.emitter.emit({ kind: 'devicesChanged', devices: this.devices() })
  }

  noteOn(note: number, velocity = 100): void {
    if (this.activeId === null) return
    this.emitter.emit({ kind: 'noteOn', note, velocity })
  }

  noteOff(note: number): void {
    if (this.activeId === null) return
    this.emitter.emit({ kind: 'noteOff', note })
  }
}
