import type { ScaleType } from './scaleTypes'

// Shapes are the scale's counterpart of a voicing rule (DESIGN.md §3.6):
// *how* a scale is played. A fixed built-in library — the space is small and
// every point in it is listed, so there is no shape builder.

export type RunShapeId =
  'up-1' | 'updown-1' | 'up-2' | 'updown-2' | 'up-3' | 'updown-3'

export type ScaleShapeId = RunShapeId | 'block'

// A run is judged as a sequence (§6.6); up-and-down plays the top note once.
export interface RunShape {
  kind: 'run'
  id: RunShapeId
  name: string
  octaves: number
  updown: boolean
}

// A block is every scale note held at once within an octave, judged like a
// chord (§6.2, §6.3).
export interface BlockShape {
  kind: 'block'
  id: 'block'
  name: string
}

export type ScaleShape = RunShape | BlockShape

const run = (octaves: number, updown: boolean): RunShape => ({
  kind: 'run',
  id: `${updown ? 'updown' : 'up'}-${octaves}` as RunShapeId,
  name: `${octaves} ${octaves === 1 ? 'octave' : 'octaves'} ${updown ? '↕' : '↑'}`,
  octaves,
  updown,
})

export const SCALE_SHAPES: readonly ScaleShape[] = [
  run(1, false),
  run(1, true),
  run(2, false),
  run(2, true),
  run(3, false),
  run(3, true),
  { kind: 'block', id: 'block', name: 'block' },
]

const BY_ID = new Map(SCALE_SHAPES.map((shape) => [shape.id, shape]))

export function getScaleShape(id: ScaleShapeId): ScaleShape {
  const shape = BY_ID.get(id)
  if (!shape) throw new Error(`Unknown scale shape: ${id}`)
  return shape
}

export function isScaleShapeId(id: string): id is ScaleShapeId {
  return BY_ID.has(id as ScaleShapeId)
}

// Notes a rep plays for a scale of `degrees` notes per octave (7 for a
// scale, 3 for an arpeggio). A block's count is its required notes — the
// top root it may add is optional (§6.3).
export function shapeNoteCount(shape: ScaleShape, degrees = 7): number {
  if (shape.kind === 'block') return degrees
  const up = shape.octaves * degrees
  return (shape.updown ? up * 2 : up) + 1
}

// An arpeggio has no block: held at once it is the triad itself, which the
// Chords side drills (§3.6).
export function shapeFits(shape: ScaleShape, type: ScaleType): boolean {
  return shape.kind === 'run' || type.family === 'scale'
}

// The grade multiplier (§3.6) scales the whole §5 speed ramp and the §6.2
// ceiling for a combo: a quarter-second per note the rep plays, rounded and
// at least 1, so a letter costs the same fraction of a run as of a chord. It
// takes the type as well as the shape — an arpeggio's runs are shorter.
export function gradeMultiplier(shape: ScaleShape, type: ScaleType): number {
  const notes = shapeNoteCount(shape, type.intervals.length)
  return Math.max(1, Math.round(notes / 4))
}
