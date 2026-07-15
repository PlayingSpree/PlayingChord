import { describe, expect, it } from 'vitest'
import { SimulatedMidiSource } from './simulatedMidiSource'
import type { MidiEvent } from './types'

const piano = { id: 'p1', name: 'Test Piano' }

function record(sim: SimulatedMidiSource): MidiEvent[] {
  const events: MidiEvent[] = []
  sim.subscribe((event) => events.push(event))
  return events
}

describe('SimulatedMidiSource', () => {
  it('reports support and initial devices', async () => {
    const sim = new SimulatedMidiSource([piano])
    await expect(sim.init()).resolves.toBe('ok')
    expect(sim.devices()).toEqual([piano])
  })

  it('emits devicesChanged on connect and disconnect', () => {
    const sim = new SimulatedMidiSource()
    const events = record(sim)
    sim.connect(piano)
    sim.disconnect(piano.id)
    expect(events).toEqual([
      { kind: 'devicesChanged', devices: [piano] },
      { kind: 'devicesChanged', devices: [] },
    ])
  })

  it('emits note events only while a device is active', () => {
    const sim = new SimulatedMidiSource([piano])
    const events = record(sim)
    sim.noteOn(60)
    expect(events).toEqual([])

    sim.setActiveDevice(piano.id)
    sim.noteOn(60)
    sim.noteOff(60)
    expect(events).toEqual([
      { kind: 'noteOn', note: 60, velocity: 100 },
      { kind: 'noteOff', note: 60 },
    ])
  })

  it('unsubscribing stops delivery', () => {
    const sim = new SimulatedMidiSource([piano])
    sim.setActiveDevice(piano.id)
    const events: MidiEvent[] = []
    const unsubscribe = sim.subscribe((event) => events.push(event))
    sim.noteOn(60)
    unsubscribe()
    sim.noteOn(64)
    expect(events).toEqual([{ kind: 'noteOn', note: 60, velocity: 100 }])
  })
})
