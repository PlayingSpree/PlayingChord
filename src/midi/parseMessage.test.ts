import { describe, expect, it } from 'vitest'
import { parseMidiMessage } from './parseMessage'

const bytes = (...values: number[]) => new Uint8Array(values)

describe('parseMidiMessage', () => {
  it('decodes note-on with velocity', () => {
    expect(parseMidiMessage(bytes(0x90, 60, 100))).toEqual({
      kind: 'noteOn',
      note: 60,
      velocity: 100,
    })
  })

  it('decodes note-off', () => {
    expect(parseMidiMessage(bytes(0x80, 60, 64))).toEqual({
      kind: 'noteOff',
      note: 60,
    })
  })

  it('treats note-on with velocity 0 as note-off', () => {
    expect(parseMidiMessage(bytes(0x90, 60, 0))).toEqual({
      kind: 'noteOff',
      note: 60,
    })
  })

  it('decodes notes on any channel', () => {
    expect(parseMidiMessage(bytes(0x93, 72, 80))).toEqual({
      kind: 'noteOn',
      note: 72,
      velocity: 80,
    })
    expect(parseMidiMessage(bytes(0x8f, 72, 0))).toEqual({
      kind: 'noteOff',
      note: 72,
    })
  })

  it('ignores non-note messages (CC/sustain, pitch bend, aftertouch)', () => {
    expect(parseMidiMessage(bytes(0xb0, 64, 127))).toBeNull() // sustain pedal
    expect(parseMidiMessage(bytes(0xe0, 0, 64))).toBeNull() // pitch bend
    expect(parseMidiMessage(bytes(0xa0, 60, 40))).toBeNull() // aftertouch
  })

  it('ignores malformed or missing data', () => {
    expect(parseMidiMessage(null)).toBeNull()
    expect(parseMidiMessage(undefined)).toBeNull()
    expect(parseMidiMessage(bytes())).toBeNull()
    expect(parseMidiMessage(bytes(0x90, 60))).toBeNull()
  })
})
