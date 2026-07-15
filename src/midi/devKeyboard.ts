import type { SimulatedMidiSource } from './simulatedMidiSource'

// Dev-only helper (enabled via ?midi=sim): plays the simulated source from
// the QWERTY home row, Ableton-style — A=C4 up to K=C5, black keys on the
// row above. Not a user-facing input mode (DESIGN.md non-goal §1).
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
}

export function attachQwertyKeys(sim: SimulatedMidiSource): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return
    const note = KEY_TO_NOTE[event.key.toLowerCase()]
    if (note !== undefined) sim.noteOn(note)
  }
  const onKeyUp = (event: KeyboardEvent) => {
    const note = KEY_TO_NOTE[event.key.toLowerCase()]
    if (note !== undefined) sim.noteOff(note)
  }
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
  }
}
