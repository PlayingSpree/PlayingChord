import { describe, expect, it } from 'vitest'
import { getChordType, type Chord, type ChordTypeId } from './chordTypes'
import {
  getBuiltInVoicingRule,
  type PatternVoicingRule,
  type VoicingRule,
} from './voicingRules'
import {
  DEFAULT_MATCH_SETTINGS,
  isDefinitivelyUnsatisfiable,
  matches,
  requiredNoteCount,
  type MatchSettings,
} from './matcher'

const chord = (root: number, id: ChordTypeId): Chord => ({
  root,
  type: getChordType(id),
})
const rule = getBuiltInVoicingRule

const cMaj = chord(0, 'maj')

const strictOff: MatchSettings = {
  ...DEFAULT_MATCH_SETTINGS,
  strictExtraNotes: false,
}
const doublingOff: MatchSettings = {
  ...DEFAULT_MATCH_SETTINGS,
  allowOctaveDoubling: false,
}

describe('matches — chord tones and extras (§6.3)', () => {
  it('matches a plain triad under any voicing', () => {
    expect(matches([60, 64, 67], cMaj, rule('any'))).toBe(true)
  })

  it('rejects an empty or incomplete held set', () => {
    expect(matches([], cMaj, rule('any'))).toBe(false)
    expect(matches([60, 64], cMaj, rule('any'))).toBe(false)
  })

  it('accepts octave doubles when the rule allows doubling', () => {
    expect(matches([48, 64, 67, 72], cMaj, rule('any'))).toBe(true)
  })

  it('rejects extra non-chord notes when strict (default)', () => {
    expect(matches([60, 64, 66, 67], cMaj, rule('any'))).toBe(false)
  })

  it('tolerates extra notes with strict off, but still requires all tones', () => {
    expect(matches([60, 64, 66, 67], cMaj, rule('any'), strictOff)).toBe(true)
    expect(matches([60, 64, 66], cMaj, rule('any'), strictOff)).toBe(false)
  })
})

describe('matches — doubling (§6.3)', () => {
  it("rejects doubles under an 'exact' rule", () => {
    expect(matches([60, 64, 67], cMaj, rule('closed'))).toBe(true)
    expect(matches([60, 64, 67, 72], cMaj, rule('closed'))).toBe(false)
  })

  it("the allow-octave-doubling setting off forces every rule to 'exact'", () => {
    expect(matches([48, 64, 67, 72], cMaj, rule('any'), doublingOff)).toBe(
      false,
    )
    expect(matches([60, 64, 67], cMaj, rule('any'), doublingOff)).toBe(true)
  })
})

describe('matches — bass constraints (inversions)', () => {
  it('root position requires the root in the bass', () => {
    expect(matches([60, 64, 67], cMaj, rule('root-position'))).toBe(true)
    expect(matches([64, 67, 72], cMaj, rule('root-position'))).toBe(false)
  })

  it('first inversion requires the third in the bass', () => {
    expect(matches([64, 67, 72], cMaj, rule('first-inversion'))).toBe(true)
    expect(matches([60, 64, 67], cMaj, rule('first-inversion'))).toBe(false)
  })

  it('second inversion requires the fifth in the bass', () => {
    expect(matches([55, 60, 64], cMaj, rule('second-inversion'))).toBe(true)
    expect(matches([60, 64, 67], cMaj, rule('second-inversion'))).toBe(false)
  })

  it('a bass degree out of range for the chord type never matches', () => {
    const impossible: VoicingRule = {
      id: 'x',
      name: 'x',
      bass: { kind: 'chordTone', degree: 5 },
      doubling: 'allowed',
    }
    expect(matches([60, 64, 67], cMaj, impossible)).toBe(false)
  })
})

describe('matches — span constraints', () => {
  it('closed rejects a spread voicing (span > 11)', () => {
    // C4 E4 G5: all tones, root bass, no doubles — but span 19.
    expect(matches([60, 64, 79], cMaj, rule('closed'))).toBe(false)
  })

  it('open requires span ≥ 12', () => {
    expect(matches([60, 64, 67], cMaj, rule('open'))).toBe(false)
    expect(matches([60, 67, 76], cMaj, rule('open'))).toBe(true)
  })

  it("open's exact doubling stops a closed voicing + octave double from counting (§3.3)", () => {
    // C4 E4 G4 C5 spans 12 but doubles the root.
    expect(matches([60, 64, 67, 72], cMaj, rule('open'))).toBe(false)
  })
})

describe('matches — pitch-class identities (§3.2)', () => {
  it('accepts Csus2 notes as Gsus4 (shared pitch-class set)', () => {
    expect(matches([60, 62, 67], chord(7, 'sus4'), rule('any'))).toBe(true)
  })

  it('accepts Cdim7 notes as E♭dim7 (symmetric chord)', () => {
    expect(matches([60, 63, 66, 69], chord(3, 'dim7'), rule('any'))).toBe(true)
  })

  it('accepts Caug notes as Eaug (symmetric chord)', () => {
    expect(matches([60, 64, 68], chord(4, 'aug'), rule('any'))).toBe(true)
  })
})

describe('matches — extended chords are literal (§3.2)', () => {
  it('dom9 needs the 9th present', () => {
    const cDom9 = chord(0, 'dom9')
    expect(matches([60, 64, 67, 70], cDom9, rule('any'))).toBe(false)
    expect(matches([48, 52, 55, 58, 62], cDom9, rule('any'))).toBe(true)
  })

  it('dom13 needs all seven tones, two hands allowed', () => {
    const cDom13 = chord(0, 'dom13')
    expect(matches([48, 52, 55, 58, 62, 65], cDom13, rule('any'))).toBe(false)
    expect(matches([48, 52, 55, 58, 62, 65, 69], cDom13, rule('any'))).toBe(
      true,
    )
  })
})

describe('isDefinitivelyUnsatisfiable (§6.2)', () => {
  it('true when a non-chord pitch class is held with strict on', () => {
    expect(isDefinitivelyUnsatisfiable([60, 61], cMaj, rule('any'))).toBe(true)
  })

  it('false for the same notes with strict off (extras are tolerated)', () => {
    expect(
      isDefinitivelyUnsatisfiable([60, 61], cMaj, rule('any'), strictOff),
    ).toBe(false)
  })

  it('true when the span max is already exceeded', () => {
    expect(isDefinitivelyUnsatisfiable([60, 79], cMaj, rule('closed'))).toBe(
      true,
    )
  })

  it("true when doubling is violated under 'exact'", () => {
    expect(isDefinitivelyUnsatisfiable([60, 72], cMaj, rule('closed'))).toBe(
      true,
    )
    expect(
      isDefinitivelyUnsatisfiable([60, 72], cMaj, rule('any'), doublingOff),
    ).toBe(true)
  })

  it("false for a doubled tone under 'allowed'", () => {
    expect(
      isDefinitivelyUnsatisfiable([60, 72], cMaj, rule('root-position')),
    ).toBe(false)
  })

  it('false for a complete triad in the wrong inversion (a lower key could fix it)', () => {
    expect(
      isDefinitivelyUnsatisfiable([60, 64, 67], cMaj, rule('first-inversion')),
    ).toBe(false)
  })

  it('false for a correct-but-incomplete attempt or an empty set', () => {
    expect(isDefinitivelyUnsatisfiable([60, 64], cMaj, rule('any'))).toBe(false)
    expect(isDefinitivelyUnsatisfiable([], cMaj, rule('any'))).toBe(false)
  })

  it('false when the span minimum is not yet met (a wider key could fix it)', () => {
    expect(isDefinitivelyUnsatisfiable([60, 64, 67], cMaj, rule('open'))).toBe(
      false,
    )
  })
})

describe('matches — pattern rules (two-hand shapes, §3.3)', () => {
  const onePlusFive: PatternVoicingRule = {
    kind: 'pattern',
    id: 'lh15-rh125',
    name: '1-5 + 1-2-5',
    leftHand: [1, 5],
    rightHand: [1, 2, 5],
  }

  it('matches C3 G3 C4 D4 G4 for LH 1-5 / RH 1-2-5 on C major', () => {
    expect(matches([48, 55, 60, 62, 67], cMaj, onePlusFive)).toBe(true)
  })

  it('rejects the wrong note count', () => {
    expect(matches([48, 55, 60, 62], cMaj, onePlusFive)).toBe(false)
    expect(matches([48, 55, 60, 62, 67, 72], cMaj, onePlusFive)).toBe(false)
  })

  it('rejects a broken order even with the right pitch classes', () => {
    // D swapped below the first C — same pitch-class multiset, wrong order.
    expect(matches([48, 50, 55, 60, 67], cMaj, onePlusFive)).toBe(false)
  })

  it('is octave-placement-free (any register satisfying the order)', () => {
    expect(matches([36, 43, 48, 50, 55], cMaj, onePlusFive)).toBe(true)
  })

  it('rejects when a pattern degree is unsatisfiable for the chord', () => {
    const needsSeventh: PatternVoicingRule = {
      kind: 'pattern',
      id: 'x',
      name: 'x',
      leftHand: [],
      rightHand: [1, 3, 5, 7],
    }
    expect(matches([60, 64, 67, 71], cMaj, needsSeventh)).toBe(false)
  })
})

describe('isDefinitivelyUnsatisfiable — pattern rules', () => {
  const onePlusFive: PatternVoicingRule = {
    kind: 'pattern',
    id: 'lh15-rh125',
    name: '1-5 + 1-2-5',
    leftHand: [1, 5],
    rightHand: [1, 2, 5],
  }

  it('false for an empty or extendable partial attempt', () => {
    expect(isDefinitivelyUnsatisfiable([], cMaj, onePlusFive)).toBe(false)
    expect(isDefinitivelyUnsatisfiable([48], cMaj, onePlusFive)).toBe(false)
    expect(isDefinitivelyUnsatisfiable([48, 55], cMaj, onePlusFive)).toBe(false)
  })

  it('true for a foreign pitch class', () => {
    expect(isDefinitivelyUnsatisfiable([49], cMaj, onePlusFive)).toBe(true)
  })

  it('true once too many notes are held', () => {
    expect(
      isDefinitivelyUnsatisfiable([48, 55, 60, 62, 67, 72], cMaj, onePlusFive),
    ).toBe(true)
  })

  it('true when held order breaks the achievable sequence', () => {
    expect(isDefinitivelyUnsatisfiable([67, 67, 67], cMaj, onePlusFive)).toBe(
      true,
    )
  })
})

describe('requiredNoteCount', () => {
  it("a constraint rule's size is the chord's tone count", () => {
    expect(requiredNoteCount(cMaj, rule('any'))).toBe(3)
    expect(requiredNoteCount(chord(0, 'dom13'), rule('any'))).toBe(7)
  })

  it("a pattern rule's size is its own note count, independent of the chord", () => {
    const onePlusFive: PatternVoicingRule = {
      kind: 'pattern',
      id: 'x',
      name: 'x',
      leftHand: [1, 5],
      rightHand: [1, 2, 5],
    }
    expect(requiredNoteCount(cMaj, onePlusFive)).toBe(5)
  })
})
