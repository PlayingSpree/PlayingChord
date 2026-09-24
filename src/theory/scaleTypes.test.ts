import { describe, expect, it } from 'vitest'
import { ALL_PITCH_CLASSES, pitchClass } from './notes'
import {
  SCALE_TYPES,
  getScaleType,
  isScaleTypeId,
  scaleFingering,
  scalePitchClasses,
  scaleThumbNotes,
  type Hand,
  type Scale,
  type ScaleTypeId,
} from './scaleTypes'
import { getScaleShape } from './scaleShapes'
import { realizeScale } from './realize'

const scale = (root: number, id: ScaleTypeId): Scale => ({
  root,
  type: getScaleType(id),
})

const HANDS: readonly Hand[] = ['rh', 'lh']
const BLACK_KEYS = new Set([1, 3, 6, 8, 10])

describe('scale types (§3.6)', () => {
  it('lists the four built-in types', () => {
    expect(SCALE_TYPES.map((t) => t.id)).toEqual([
      'major',
      'natural-minor',
      'harmonic-minor',
      'melodic-minor',
    ])
    expect(isScaleTypeId('major')).toBe(true)
    expect(isScaleTypeId('dorian')).toBe(false)
  })

  it('carries each form’s intervals, one per degree', () => {
    const semis = (id: ScaleTypeId) =>
      getScaleType(id).intervals.map((i) => i.semitones)
    expect(semis('major')).toEqual([0, 2, 4, 5, 7, 9, 11])
    expect(semis('natural-minor')).toEqual([0, 2, 3, 5, 7, 8, 10])
    expect(semis('harmonic-minor')).toEqual([0, 2, 3, 5, 7, 8, 11])
    expect(semis('melodic-minor')).toEqual([0, 2, 3, 5, 7, 9, 11])
    for (const type of SCALE_TYPES) {
      expect(type.intervals.map((i) => i.degree)).toEqual([1, 2, 3, 4, 5, 6, 7])
    }
  })

  it('gives D major its pitch classes', () => {
    expect(scalePitchClasses(scale(2, 'major'))).toEqual([2, 4, 6, 7, 9, 11, 1])
  })

  it('throws on an unknown id', () => {
    expect(() => getScaleType('dorian' as ScaleTypeId)).toThrow()
  })
})

describe('fingering (§3.6)', () => {
  it('has a one-octave row for every root × type × hand', () => {
    for (const type of SCALE_TYPES) {
      expect(type.fingering).toHaveLength(12)
      for (const row of type.fingering) {
        for (const hand of HANDS) {
          expect(row[hand]).toHaveLength(8)
          for (const finger of row[hand]) {
            expect(finger).toBeGreaterThanOrEqual(1)
            expect(finger).toBeLessThanOrEqual(5)
          }
        }
      }
    }
  })

  it('reads C major as the book prints it', () => {
    const c = scale(0, 'major')
    expect(scaleFingering(c, 'rh', 1)).toEqual([1, 2, 3, 1, 2, 3, 4, 5])
    expect(scaleFingering(c, 'lh', 1)).toEqual([5, 4, 3, 2, 1, 3, 2, 1])
  })

  it('crosses at the inner tonics of longer runs', () => {
    const c = scale(0, 'major')
    expect(scaleFingering(c, 'rh', 2)).toEqual([
      1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4, 5,
    ])
    expect(scaleFingering(c, 'lh', 2)).toEqual([
      5, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3, 2, 1,
    ])
    const bFlat = scale(10, 'major')
    expect(scaleFingering(bFlat, 'rh', 2)).toEqual([
      4, 1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4,
    ])
    expect(scaleFingering(bFlat, 'lh', 2)).toEqual([
      3, 2, 1, 4, 3, 2, 1, 3, 2, 1, 4, 3, 2, 1, 3,
    ])
    // Starts on 2, but the inner B♭ continues A♭ 3 with 4.
    const bFlatMinor = scale(10, 'natural-minor')
    expect(scaleFingering(bFlatMinor, 'rh', 2)).toEqual([
      2, 1, 2, 3, 1, 2, 3, 4, 1, 2, 3, 1, 2, 3, 4,
    ])
  })

  // Sanity properties every standard scale fingering has — they catch a
  // mistyped digit in the tables: fingers move by one step in the run's
  // direction except where the thumb passes under (RH) or a finger crosses
  // over it (LH), and the thumb never lands on a black key.
  it('is a well-formed, thumb-on-white fingering for every scale and length', () => {
    for (const type of SCALE_TYPES) {
      for (const root of ALL_PITCH_CLASSES) {
        const s: Scale = { root, type }
        for (const octaves of [1, 2, 3]) {
          const notes = realizeScale(
            s,
            getScaleShape(`up-${octaves}` as 'up-1'),
          )
          for (const hand of HANDS) {
            const fingers = scaleFingering(s, hand, octaves)
            const label = `${type.id} root=${root} ${hand} ×${octaves}`
            expect(fingers, label).toHaveLength(notes.length)
            fingers.forEach((finger, i) => {
              const note = notes[i]
              if (finger === 1 && note !== undefined) {
                expect(BLACK_KEYS.has(pitchClass(note)), label).toBe(false)
              }
              const next = fingers[i + 1]
              if (next === undefined) return
              if (hand === 'rh') {
                expect(next === finger + 1 || next === 1, label).toBe(true)
              } else {
                expect(next === finger - 1 || finger === 1, label).toBe(true)
              }
            })
          }
        }
      }
    }
  })

  it('gives the minor forms that finger differently their own rows', () => {
    const rh = (root: number, id: ScaleTypeId) =>
      scaleFingering(scale(root, id), 'rh', 1)
    const lh = (root: number, id: ScaleTypeId) =>
      scaleFingering(scale(root, id), 'lh', 1)
    // G♯ minor: natural's F♯ is black, harmonic's F𝄪 white.
    expect(lh(8, 'natural-minor')).toEqual([3, 2, 1, 3, 2, 1, 4, 3])
    expect(lh(8, 'harmonic-minor')).toEqual([3, 2, 1, 4, 3, 2, 1, 3])
    // C♯ / F♯ melodic: the raised 6th is black, so the RH regroups.
    expect(rh(1, 'harmonic-minor')).toEqual([3, 4, 1, 2, 3, 1, 2, 3])
    expect(rh(1, 'melodic-minor')).toEqual([2, 3, 1, 2, 3, 4, 1, 2])
    expect(rh(6, 'melodic-minor')).toEqual([2, 3, 1, 2, 3, 4, 1, 2])
  })
})

describe('thumb notes (§6.6)', () => {
  const c = scale(0, 'major')
  const run = (shape: 'up-1' | 'up-2' | 'updown-2') =>
    realizeScale(c, getScaleShape(shape))

  it('marks the keys finger 1 plays, per hand', () => {
    expect(scaleThumbNotes(c, 'rh', 1, run('up-1'))).toEqual(new Set([60, 65]))
    expect(scaleThumbNotes(c, 'lh', 1, run('up-1'))).toEqual(new Set([67, 72]))
  })

  it('picks up the inner-tonic crossing of a longer run', () => {
    // Two octaves start an octave down: C3 F3 C4 F4.
    expect(scaleThumbNotes(c, 'rh', 2, run('up-2'))).toEqual(
      new Set([48, 53, 60, 65]),
    )
  })

  it('gives an up-and-down run the same keys as its ascent', () => {
    expect(scaleThumbNotes(c, 'lh', 2, run('updown-2'))).toEqual(
      scaleThumbNotes(c, 'lh', 2, run('up-2')),
    )
  })
})
