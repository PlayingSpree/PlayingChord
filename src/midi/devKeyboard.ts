import type { SimulatedMidiSource } from './simulatedMidiSource'

// Dev-only helper (enabled via ?midi=sim): plays the simulated source from
// the QWERTY home row, Ableton-style — A=C4 up to ' = F5, black keys on the
// row above — with Z / X shifting the whole row an octave down / up, so the
// two- and three-octave scale runs (DESIGN.md §3.6) are playable too. Not a
// user-facing input mode (DESIGN.md non-goal §1).
const KEY_TO_NOTE: Record<string, number> = {
  a: 60,
  w: 61,
  s: 62,
  e: 63,
  d: 64,
  f: 65,
  t: 66,
  g: 67,
  y: 68,
  h: 69,
  u: 70,
  j: 71,
  k: 72,
  o: 73,
  l: 74,
  p: 75,
  ';': 76,
  "'": 77,
}

const OCTAVE_DOWN = 'z'
const OCTAVE_UP = 'x'
// Three octaves either way: C1 … F8, well inside MIDI's range and past
// both ends of any run the app deals.
export const MAX_OCTAVE_SHIFT = 3

type NoteSink = Pick<SimulatedMidiSource, 'noteOn' | 'noteOff'>

// The key → note logic, apart from the DOM so it can be tested. A key
// releases the note it pressed, whatever the octave is by then — shifting
// mid-hold must never leave a note stuck down.
export class QwertyKeyboard {
  private readonly sink: NoteSink
  private shift = 0
  private readonly down = new Map<string, number>()

  constructor(sink: NoteSink) {
    this.sink = sink
  }

  get octave(): number {
    return this.shift
  }

  keyDown(key: string): void {
    const k = key.toLowerCase()
    if (k === OCTAVE_DOWN || k === OCTAVE_UP) {
      const step = k === OCTAVE_UP ? 1 : -1
      this.shift = Math.max(
        -MAX_OCTAVE_SHIFT,
        Math.min(MAX_OCTAVE_SHIFT, this.shift + step),
      )
      return
    }
    const base = KEY_TO_NOTE[k]
    if (base === undefined || this.down.has(k)) return
    const note = base + 12 * this.shift
    this.down.set(k, note)
    this.sink.noteOn(note)
  }

  keyUp(key: string): void {
    const k = key.toLowerCase()
    const note = this.down.get(k)
    if (note === undefined) return
    this.down.delete(k)
    this.sink.noteOff(note)
  }
}

export function attachQwertyKeys(sim: SimulatedMidiSource): () => void {
  const keyboard = new QwertyKeyboard(sim)
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return
    keyboard.keyDown(event.key)
  }
  const onKeyUp = (event: KeyboardEvent) => keyboard.keyUp(event.key)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
  }
}
