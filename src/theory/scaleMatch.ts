import { pitchClass } from './notes'
import { scalePitchClasses, type Scale } from './scaleTypes'

// Block-scale matching (DESIGN.md §6.3): every pitch class of the scale held
// exactly once, the root lowest and the span within an octave — the root an
// octave up may be added on top (7 or 8 notes, span ≤ 12). The doubling and
// strict-extra-notes settings don't apply, as they don't to pattern rules.

const OCTAVE = 12

function sorted(held: Iterable<number>): number[] {
  return [...held].sort((a, b) => a - b)
}

export function matchesScaleBlock(
  held: Iterable<number>,
  scale: Scale,
): boolean {
  const notes = sorted(held)
  const low = notes[0]
  const high = notes.at(-1)
  if (low === undefined || high === undefined) return false
  if (pitchClass(low) !== pitchClass(scale.root)) return false
  if (high - low > OCTAVE) return false
  const body =
    notes.length > 1 && high === low + OCTAVE ? notes.slice(0, -1) : notes
  const pcs = scalePitchClasses(scale)
  const bodyPcs = new Set(body.map(pitchClass))
  return (
    body.length === pcs.length &&
    bodyPcs.size === pcs.length &&
    pcs.every((pc) => bodyPcs.has(pc))
  )
}

// No added key could fix it: a foreign pitch class, a span past an octave,
// or a second copy of a scale tone — only the root may repeat, and only as
// the top note, which within an octave is the one place a second root fits.
export function isScaleBlockDefinitivelyUnsatisfiable(
  held: Iterable<number>,
  scale: Scale,
): boolean {
  const notes = sorted(held)
  const low = notes[0]
  const high = notes.at(-1)
  if (low === undefined || high === undefined) return false
  const pcs = new Set(scalePitchClasses(scale))
  if (notes.some((note) => !pcs.has(pitchClass(note)))) return true
  if (high - low > OCTAVE) return true
  const root = pitchClass(scale.root)
  const counts = new Map<number, number>()
  for (const note of notes) {
    const pc = pitchClass(note)
    counts.set(pc, (counts.get(pc) ?? 0) + 1)
  }
  for (const [pc, count] of counts) {
    if (count > (pc === root ? 2 : 1)) return true
  }
  return false
}

// A full block attempt, for §6.2's stall: one note per scale degree.
export function scaleBlockNoteCount(scale: Scale): number {
  return scale.type.intervals.length
}
