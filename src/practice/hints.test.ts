import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MATCH_SETTINGS,
  voicingLibrary,
  type MatchSettings,
  type PatternVoicingRule,
} from '../theory'
import { computeHint, REVEAL_AFTER_MISSES } from './hints'
import { createPrompt } from './prompts'
import type { ChordTypeId } from '../theory'

const prompt = (root: number, typeId: ChordTypeId, voicingId: string) =>
  createPrompt({ root, typeId, voicingId })

const hint = (
  missCount: number,
  notes: number[],
  p: ReturnType<typeof createPrompt>,
  settings: MatchSettings = DEFAULT_MATCH_SETTINGS,
) => computeHint(missCount, new Set(notes), p, settings)

// MIDI shorthand used throughout: C4=60 C♯4=61 E4=64 F4=65 G4=67 C5=72 E5=76 G5=79

describe('computeHint — stage 1–2: wrong keys (§6.4)', () => {
  it('marks held keys whose pitch class is not a chord tone', () => {
    const h = hint(1, [60, 64, 61], prompt(0, 'maj', 'any'))
    expect(h).toEqual({ kind: 'wrong-keys', notes: [61] })
  })

  it('lists multiple wrong keys sorted ascending', () => {
    const h = hint(2, [66, 60, 61, 64], prompt(0, 'maj', 'any'))
    expect(h).toEqual({ kind: 'wrong-keys', notes: [61, 66] })
  })

  it('never blames extra keys when strict extra notes is off', () => {
    // 61 is foreign but tolerated; the real failure is the bass.
    const h = hint(1, [61, 64, 67, 72], prompt(0, 'maj', 'root-position'), {
      ...DEFAULT_MATCH_SETTINGS,
      strictExtraNotes: false,
    })
    expect(h).toEqual({ kind: 'constraint', text: 'Bass must be the root' })
  })
})

describe('computeHint — stage 1–2: constraint text (§6.4)', () => {
  it('names the bass degree for a wrong inversion', () => {
    // Root position played against a 1st-inversion drill.
    const h = hint(1, [60, 64, 67], prompt(0, 'maj', 'first-inversion'))
    expect(h).toEqual({ kind: 'constraint', text: 'Bass must be the 3rd' })
  })

  it('says "root" for a root-position bass failure', () => {
    const h = hint(1, [64, 67, 72], prompt(0, 'maj', 'root-position'))
    expect(h).toEqual({ kind: 'constraint', text: 'Bass must be the root' })
  })

  it('uses the interval degree, not the index (sus4 1st inversion → 4th)', () => {
    const h = hint(1, [60, 65, 67], prompt(0, 'sus4', 'first-inversion'))
    expect(h).toEqual({ kind: 'constraint', text: 'Bass must be the 4th' })
  })

  it('names missing chord tones by degree', () => {
    // C4 E4 E5 — three keys, but no 5th anywhere.
    const h = hint(1, [60, 64, 76], prompt(0, 'maj', 'any'))
    expect(h).toEqual({ kind: 'constraint', text: 'Missing the 5th' })
  })

  it('lists several missing tones', () => {
    const h = hint(1, [60, 72, 84], prompt(0, 'maj', 'any'))
    expect(h).toEqual({ kind: 'constraint', text: 'Missing the 3rd and 5th' })
  })

  it('blames doubling before missing tones (adding notes cannot fix it)', () => {
    const h = hint(1, [60, 64, 72], prompt(0, 'maj', 'closed'))
    expect(h).toEqual({
      kind: 'constraint',
      text: 'Octave doubling not allowed',
    })
  })

  it('blames doubling when the global toggle forces exact', () => {
    const h = hint(1, [60, 64, 67, 72], prompt(0, 'maj', 'any'), {
      ...DEFAULT_MATCH_SETTINGS,
      allowOctaveDoubling: false,
    })
    expect(h).toEqual({
      kind: 'constraint',
      text: 'Octave doubling not allowed',
    })
  })

  it('reports span too wide', () => {
    // C4 E4 G5 under closed: all tones, right bass, span 19 > 11.
    const h = hint(1, [60, 64, 79], prompt(0, 'maj', 'closed'))
    expect(h).toEqual({ kind: 'constraint', text: 'Span too wide' })
  })

  it('reports span too narrow', () => {
    // Compact triad under open (min 12).
    const h = hint(1, [60, 64, 67], prompt(0, 'maj', 'open'))
    expect(h).toEqual({ kind: 'constraint', text: 'Span too narrow' })
  })
})

describe(`computeHint — stage 3: reveal after ${REVEAL_AFTER_MISSES} misses`, () => {
  it('reveals the example voicing from the 3rd miss', () => {
    const p = prompt(0, 'maj', 'first-inversion')
    const h = hint(REVEAL_AFTER_MISSES, [60, 64, 67], p)
    expect(h).toEqual({ kind: 'reveal', notes: p.example })
  })

  it('stays revealed on later misses, even with wrong keys held', () => {
    const p = prompt(0, 'maj', 'any')
    const h = hint(REVEAL_AFTER_MISSES + 2, [61, 62], p)
    expect(h).toEqual({ kind: 'reveal', notes: p.example })
  })

  it('returns a fresh copy of the example, not the prompt array itself', () => {
    const p = prompt(0, 'maj', 'any')
    const h = hint(REVEAL_AFTER_MISSES, [61], p)
    expect(h.kind).toBe('reveal')
    if (h.kind === 'reveal') expect(h.notes).not.toBe(p.example)
  })
})

describe('computeHint — pattern rules (§3.3, §6.4)', () => {
  const onePlusFive: PatternVoicingRule = {
    kind: 'pattern',
    id: 'lh15-rh125',
    name: '1-5 + 1-2-5',
    leftHand: [1, 5],
    rightHand: [1, 2, 5],
  }
  const patternPrompt = () =>
    createPrompt(
      { root: 0, typeId: 'maj', voicingId: onePlusFive.id },
      undefined,
      voicingLibrary([onePlusFive]),
    )

  it('marks a foreign pitch class as a wrong key', () => {
    // C3 G3 C♯4 D4 G4 — the C♯ isn't part of the pattern's pitch classes.
    const h = hint(1, [48, 55, 61, 62, 67], patternPrompt())
    expect(h).toEqual({ kind: 'wrong-keys', notes: [61] })
  })

  it('reports too many notes when every pc is valid but there are extras', () => {
    // The full 5-note pattern plus a doubled root — no foreign pc, but 6
    // held notes against a 5-note target.
    const h = hint(1, [48, 55, 60, 62, 67, 72], patternPrompt())
    expect(h).toEqual({
      kind: 'constraint',
      text: 'Too many notes for this pattern',
    })
  })

  it('reports order broken when pcs are valid but out of sequence', () => {
    // Three G's (G3 G4 G5) — the target only has two G slots (positions 1
    // and 4), so a third can never be placed no matter what else is added.
    const h = hint(1, [55, 67, 79], patternPrompt())
    expect(h).toEqual({
      kind: 'constraint',
      text: 'Notes out of order for this pattern',
    })
  })

  it('reveals the example after enough misses, same as constraint rules', () => {
    const p = patternPrompt()
    const h = hint(REVEAL_AFTER_MISSES, [55, 67, 79], p)
    expect(h).toEqual({ kind: 'reveal', notes: p.example })
  })
})
