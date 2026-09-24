// Shapes are the scale's counterpart of a voicing rule (DESIGN.md §3.6):
// *how* a scale is played. A fixed built-in library — the space is small and
// every point in it is listed, so there is no shape builder.
//
// The grade multiplier scales the whole §5 speed ramp and the §6.2 ceiling
// for a combo of that shape: about a quarter-second per note for runs,
// rounded, so a letter costs the same fraction of a run as of a chord.

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
  gradeMultiplier: number
}

// A block is every scale note held at once within an octave, judged like a
// chord (§6.2, §6.3).
export interface BlockShape {
  kind: 'block'
  id: 'block'
  name: string
  gradeMultiplier: number
}

export type ScaleShape = RunShape | BlockShape

const run = (
  octaves: number,
  updown: boolean,
  gradeMultiplier: number,
): RunShape => ({
  kind: 'run',
  id: `${updown ? 'updown' : 'up'}-${octaves}` as RunShapeId,
  name: `${octaves} ${octaves === 1 ? 'octave' : 'octaves'} ${updown ? '↕' : '↑'}`,
  octaves,
  updown,
  gradeMultiplier,
})

export const SCALE_SHAPES: readonly ScaleShape[] = [
  run(1, false, 2),
  run(1, true, 4),
  run(2, false, 4),
  run(2, true, 7),
  run(3, false, 6),
  run(3, true, 11),
  { kind: 'block', id: 'block', name: 'block', gradeMultiplier: 2 },
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

// Notes a rep plays for a scale of `degrees` notes per octave (7 for every
// built-in type). A block's count is its required notes — the top root it
// may add is optional (§6.3).
export function shapeNoteCount(shape: ScaleShape, degrees = 7): number {
  if (shape.kind === 'block') return degrees
  const up = shape.octaves * degrees
  return (shape.updown ? up * 2 : up) + 1
}
