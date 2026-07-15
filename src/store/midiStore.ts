import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type {
  MidiDeviceInfo,
  MidiEvent,
  MidiSource,
  MidiSupport,
} from '../midi'

// Remembers the last used device (DESIGN.md §6.1). Device ids can be
// unstable across sessions on some OSes, so matching falls back to the
// device name. Plain localStorage key for now; migrates into the versioned
// storage schema in Phase 6.
export interface DeviceMemory {
  load(): MidiDeviceInfo | null
  save(device: MidiDeviceInfo): void
}

const STORAGE_KEY = 'playingchord:lastMidiDevice'

function isDeviceInfo(value: unknown): value is MidiDeviceInfo {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as MidiDeviceInfo).id === 'string' &&
    typeof (value as MidiDeviceInfo).name === 'string'
  )
}

export const localStorageDeviceMemory: DeviceMemory = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      const parsed: unknown = JSON.parse(raw)
      return isDeviceInfo(parsed) ? parsed : null
    } catch {
      return null
    }
  },
  save(device) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(device))
    } catch {
      // Private-mode or quota failures just lose the convenience.
    }
  },
}

export interface MidiStoreState {
  support: 'pending' | MidiSupport
  devices: MidiDeviceInfo[]
  // null while no device is connected — the practice view is replaced by a
  // blocking "connect a keyboard" screen (DESIGN.md §6.1).
  activeDeviceId: string | null
  heldNotes: ReadonlySet<number>
  initialize(source: MidiSource): Promise<void>
  selectDevice(id: string): void
}

export function createMidiStore(
  memory: DeviceMemory = localStorageDeviceMemory,
) {
  let source: MidiSource | null = null
  let started = false

  return createStore<MidiStoreState>()((set, get) => {
    // Held notes are cleared on any device switch: notes held on another
    // (or unplugged) device must never be judged against a prompt.
    const setActive = (id: string | null) => {
      source?.setActiveDevice(id)
      if (id !== get().activeDeviceId) {
        set({ activeDeviceId: id, heldNotes: new Set<number>() })
      }
      if (id !== null) {
        const device = get().devices.find((d) => d.id === id)
        if (device) memory.save(device)
      }
    }

    const reconcileDevices = (devices: MidiDeviceInfo[]) => {
      set({ devices })
      const { activeDeviceId } = get()
      if (
        activeDeviceId !== null &&
        devices.some((d) => d.id === activeDeviceId)
      ) {
        return
      }
      const remembered = memory.load()
      const next =
        devices.find((d) => d.id === remembered?.id) ??
        devices.find((d) => d.name === remembered?.name) ??
        devices[0] ??
        null
      setActive(next?.id ?? null)
    }

    const handleEvent = (event: MidiEvent) => {
      switch (event.kind) {
        case 'devicesChanged':
          reconcileDevices(event.devices)
          break
        case 'noteOn': {
          const held = new Set(get().heldNotes)
          held.add(event.note)
          set({ heldNotes: held })
          break
        }
        case 'noteOff': {
          const held = new Set(get().heldNotes)
          held.delete(event.note)
          set({ heldNotes: held })
          break
        }
      }
    }

    return {
      support: 'pending',
      devices: [],
      activeDeviceId: null,
      heldNotes: new Set<number>(),

      async initialize(s: MidiSource) {
        if (started) return // React StrictMode mounts effects twice
        started = true
        source = s
        const support = await s.init()
        set({ support })
        if (support !== 'ok') return
        s.subscribe(handleEvent)
        reconcileDevices(s.devices())
      },

      selectDevice(id: string) {
        setActive(id)
      },
    }
  })
}

export const midiStore = createMidiStore()

export function useMidi<T>(selector: (state: MidiStoreState) => T): T {
  return useStore(midiStore, selector)
}
