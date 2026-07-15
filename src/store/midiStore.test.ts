import { describe, expect, it } from 'vitest'
import {
  SimulatedMidiSource,
  type MidiDeviceInfo,
  type MidiSource,
} from '../midi'
import { createMidiStore, type DeviceMemory } from './midiStore'

const piano = { id: 'p1', name: 'Test Piano' }
const organ = { id: 'o1', name: 'Test Organ' }

function fakeMemory(initial: MidiDeviceInfo | null = null) {
  let saved = initial
  const memory: DeviceMemory & { get saved(): MidiDeviceInfo | null } = {
    load: () => saved,
    save: (device) => {
      saved = device
    },
    get saved() {
      return saved
    },
  }
  return memory
}

async function setup(devices: MidiDeviceInfo[], memory = fakeMemory()) {
  const sim = new SimulatedMidiSource(devices)
  const store = createMidiStore(memory)
  await store.getState().initialize(sim)
  return { sim, store, memory }
}

describe('midiStore — initialization', () => {
  it('records unsupported/denied and stops', async () => {
    const source: MidiSource = {
      init: () => Promise.resolve('unsupported'),
      devices: () => [],
      setActiveDevice: () => {},
      subscribe: () => () => {},
    }
    const store = createMidiStore(fakeMemory())
    await store.getState().initialize(source)
    expect(store.getState().support).toBe('unsupported')
    expect(store.getState().activeDeviceId).toBeNull()
  })

  it('auto-selects the first device and remembers it', async () => {
    const { store, memory } = await setup([piano, organ])
    expect(store.getState().support).toBe('ok')
    expect(store.getState().devices).toEqual([piano, organ])
    expect(store.getState().activeDeviceId).toBe(piano.id)
    expect(memory.saved).toEqual(piano)
  })

  it('is idempotent (StrictMode double-mount)', async () => {
    const { store } = await setup([piano])
    const second = new SimulatedMidiSource([organ])
    await store.getState().initialize(second)
    expect(store.getState().devices).toEqual([piano])
  })

  it('starts with no device when none is connected', async () => {
    const { store } = await setup([])
    expect(store.getState().activeDeviceId).toBeNull()
  })
})

describe('midiStore — remembered device', () => {
  it('prefers the remembered id over the first device', async () => {
    const { store } = await setup([piano, organ], fakeMemory(organ))
    expect(store.getState().activeDeviceId).toBe(organ.id)
  })

  it('falls back to matching by name when the id changed', async () => {
    const remembered = { id: 'stale-id', name: 'Test Organ' }
    const { store } = await setup([piano, organ], fakeMemory(remembered))
    expect(store.getState().activeDeviceId).toBe(organ.id)
  })
})

describe('midiStore — held notes', () => {
  it('tracks note-on/note-off as a set', async () => {
    const { sim, store } = await setup([piano])
    sim.noteOn(60)
    sim.noteOn(64)
    sim.noteOn(60) // duplicate on is idempotent
    expect([...store.getState().heldNotes].sort((a, b) => a - b)).toEqual([
      60, 64,
    ])
    sim.noteOff(60)
    expect([...store.getState().heldNotes]).toEqual([64])
  })

  it('clears held notes when switching devices', async () => {
    const { sim, store } = await setup([piano, organ])
    sim.noteOn(60)
    store.getState().selectDevice(organ.id)
    expect(store.getState().activeDeviceId).toBe(organ.id)
    expect(store.getState().heldNotes.size).toBe(0)
    sim.noteOn(62)
    expect([...store.getState().heldNotes]).toEqual([62])
  })
})

describe('midiStore — hot-plug (§6.1)', () => {
  it('unplugging the active device blocks and clears held notes; replug resumes', async () => {
    const { sim, store } = await setup([piano])
    sim.noteOn(60)

    sim.disconnect(piano.id)
    expect(store.getState().activeDeviceId).toBeNull()
    expect(store.getState().heldNotes.size).toBe(0)

    sim.connect(piano)
    expect(store.getState().activeDeviceId).toBe(piano.id)
  })

  it('unplugging a non-active device changes nothing', async () => {
    const { sim, store } = await setup([piano, organ])
    sim.noteOn(60)
    sim.disconnect(organ.id)
    expect(store.getState().activeDeviceId).toBe(piano.id)
    expect([...store.getState().heldNotes]).toEqual([60])
  })

  it('a newly connected device is adopted when none was active', async () => {
    const { sim, store } = await setup([])
    expect(store.getState().activeDeviceId).toBeNull()
    sim.connect(piano)
    expect(store.getState().activeDeviceId).toBe(piano.id)
  })
})
