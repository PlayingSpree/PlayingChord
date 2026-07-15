// MIDI wrapper contract (DESIGN.md §6.1): the app only ever talks to a
// MidiSource, so real hardware and the simulated dev/test source are
// interchangeable.

export interface MidiDeviceInfo {
  id: string
  name: string
}

export type MidiSupport = 'ok' | 'unsupported' | 'denied'

export type MidiEvent =
  | { kind: 'devicesChanged'; devices: MidiDeviceInfo[] }
  | { kind: 'noteOn'; note: number; velocity: number }
  | { kind: 'noteOff'; note: number }

export interface MidiSource {
  init(): Promise<MidiSupport>
  devices(): MidiDeviceInfo[]
  // Note events are only emitted for the active device.
  setActiveDevice(id: string | null): void
  subscribe(listener: (event: MidiEvent) => void): () => void
}
