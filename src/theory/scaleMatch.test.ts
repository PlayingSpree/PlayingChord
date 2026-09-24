import { describe, expect, it } from 'vitest'
import {
  isScaleBlockDefinitivelyUnsatisfiable,
  matchesScaleBlock,
  scaleBlockNoteCount,
} from './scaleMatch'
import { getScaleType, type Scale, type ScaleTypeId } from './scaleTypes'

// MIDI shorthand: C4=60 D4=62 E4=64 F4=65 G4=67 A4=69 B4=71 C5=72
const C_MAJOR = [60, 62, 64, 65, 67, 69, 71]

const scale = (root: number, id: ScaleTypeId): Scale => ({
  root,
  type: getScaleType(id),
})

describe('block scale matching (§6.3)', () => {
  const cMajor = scale(0, 'major')

  it('matches every pitch class once from the root', () => {
    expect(matchesScaleBlock(C_MAJOR, cMajor)).toBe(true)
  })

  it('allows the root an octave up on top', () => {
    expect(matchesScaleBlock([...C_MAJOR, 72], cMajor)).toBe(true)
  })

  it('matches in any octave', () => {
    expect(
      matchesScaleBlock(
        C_MAJOR.map((n) => n - 24),
        cMajor,
      ),
    ).toBe(true)
  })

  it('needs the root lowest', () => {
    // D E F G A B C — every pitch class, but D in the bass.
    expect(matchesScaleBlock([62, 64, 65, 67, 69, 71, 72], cMajor)).toBe(false)
  })

  it('needs every degree', () => {
    expect(matchesScaleBlock(C_MAJOR.slice(0, 6), cMajor)).toBe(false)
  })

  it('tells the forms of minor apart', () => {
    // A harmonic minor: A B C D E F G♯
    const harmonic = [57, 59, 60, 62, 64, 65, 68]
    expect(matchesScaleBlock(harmonic, scale(9, 'harmonic-minor'))).toBe(true)
    expect(matchesScaleBlock(harmonic, scale(9, 'natural-minor'))).toBe(false)
  })

  it('counts a full attempt as one note per degree', () => {
    expect(scaleBlockNoteCount(cMajor)).toBe(7)
  })
})

describe('block scale definitive misses (§6.3)', () => {
  const cMajor = scale(0, 'major')
  const miss = (notes: number[]) =>
    isScaleBlockDefinitivelyUnsatisfiable(notes, cMajor)

  it('is never definitive on an empty or partial correct set', () => {
    expect(miss([])).toBe(false)
    expect(miss([60, 64, 67])).toBe(false)
    // Root not lowest yet — a C below could still arrive.
    expect(miss([62, 64, 65, 67, 69, 71, 72])).toBe(false)
  })

  it('misses on a foreign pitch class', () => {
    expect(miss([60, 61])).toBe(true)
  })

  it('misses on a span past an octave', () => {
    expect(miss([60, 74])).toBe(true)
  })

  it('misses on a repeated degree other than the top root', () => {
    expect(miss([62, 74])).toBe(true) // D twice
  })

  it('allows the root twice, an octave apart', () => {
    expect(miss([60, 72])).toBe(false)
  })
})
