import type { MidiEvent } from './types'

export type NoteMessage = Extract<MidiEvent, { kind: 'noteOn' | 'noteOff' }>

// Decodes a raw MIDI message into a note event, on any channel. A note-on
// with velocity 0 is a note-off (running-status convention many keyboards
// use). Everything else (CC/sustain, aftertouch, ...) is ignored.
export function parseMidiMessage(
  data: Uint8Array | null | undefined,
): NoteMessage | null {
  if (!data || data.length < 3) return null
  const status = data[0]
  const note = data[1]
  const velocity = data[2]
  if (status === undefined || note === undefined || velocity === undefined) {
    return null
  }
  const kind = status & 0xf0
  if (kind === 0x90 && velocity > 0) return { kind: 'noteOn', note, velocity }
  if (kind === 0x80 || kind === 0x90) return { kind: 'noteOff', note }
  return null
}
