import { describe, expect, it } from 'vitest'
import { ALL_PITCH_CLASSES, MIDDLE_C, pitchClass } from './notes'
import { SCALE_TYPES, getScaleType, type Scale } from './scaleTypes'
import {
  SCALE_SHAPES,
  getScaleShape,
  isScaleShapeId,
  shapeNoteCount,
  type ScaleShapeId,
} from './scaleShapes'
import { realizeScale } from './realize'

const cMajor: Scale = { root: 0, type: getScaleType('major') }

describe('shape library (§3.6)', () => {
  it('matches the spec table: ids, note counts, grade multipliers', () => {
    expect(
      SCALE_SHAPES.map((s) => [s.id, shapeNoteCount(s), s.gradeMultiplier]),
    ).toEqual([
      ['up-1', 8, 2],
      ['updown-1', 15, 4],
      ['up-2', 15, 4],
      ['updown-2', 29, 7],
      ['up-3', 22, 6],
      ['updown-3', 43, 11],
      ['block', 7, 2],
    ])
  })

  it('labels shapes as the Stage shows them', () => {
    expect(getScaleShape('updown-2').name).toBe('2 octaves ↕')
    expect(getScaleShape('up-1').name).toBe('1 octave ↑')
    expect(getScaleShape('block').name).toBe('block')
  })

  it('recognizes its ids and throws on others', () => {
    expect(isScaleShapeId('updown-3')).toBe(true)
    expect(isScaleShapeId('up-4')).toBe(false)
    expect(() => getScaleShape('up-4' as ScaleShapeId)).toThrow()
  })
})

describe('realizeScale (§3.6)', () => {
  it('plays C major one octave up from middle C', () => {
    expect(realizeScale(cMajor, getScaleShape('up-1'))).toEqual([
      60, 62, 64, 65, 67, 69, 71, 72,
    ])
  })

  it('plays the top note of an up-and-down run once', () => {
    expect(realizeScale(cMajor, getScaleShape('updown-1'))).toEqual([
      60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60,
    ])
  })

  it('gives a block its one octave, tonic to tonic', () => {
    expect(realizeScale(cMajor, getScaleShape('block'))).toEqual(
      realizeScale(cMajor, getScaleShape('up-1')),
    )
  })

  it('starts longer runs an octave lower so they stay centred', () => {
    expect(realizeScale(cMajor, getScaleShape('up-2'))[0]).toBe(MIDDLE_C - 12)
    expect(realizeScale(cMajor, getScaleShape('updown-3'))[0]).toBe(
      MIDDLE_C - 12,
    )
  })

  it('realizes every root × type × run shape with the table’s note count', () => {
    for (const type of SCALE_TYPES) {
      for (const root of ALL_PITCH_CLASSES) {
        const s: Scale = { root, type }
        for (const shape of SCALE_SHAPES) {
          if (shape.kind !== 'run') continue
          const notes = realizeScale(s, shape)
          const label = `${type.id} root=${root} ${shape.id}`
          expect(notes, label).toHaveLength(shapeNoteCount(shape))
          expect(pitchClass(notes[0] ?? -1), label).toBe(root)
          if (shape.updown) expect(notes.at(-1), label).toBe(notes[0])
          const top = shape.updown ? notes.length >> 1 : notes.length - 1
          expect(notes[top], label).toBe((notes[0] ?? 0) + 12 * shape.octaves)
          // Strictly up to the top, strictly down after it.
          notes.forEach((note, i) => {
            const next = notes[i + 1]
            if (next === undefined) return
            if (i < top) expect(next, label).toBeGreaterThan(note)
            else expect(next, label).toBeLessThan(note)
          })
        }
      }
    }
  })
})
