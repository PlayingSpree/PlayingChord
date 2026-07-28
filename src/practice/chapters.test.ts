import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_VOICING_LIBRARY,
  formatSpelling,
  realizeVoicing,
  getChordType,
} from '../theory'
import { comboKey } from './combos'
import {
  batchOfIndex,
  CHAPTERS,
  chapterById,
  degreeRoot,
  isPathTriad,
  isValidDegree,
  MAX_BATCH_SIZE,
  PATH_COMBO_INDEX,
  PATH_TRIAD_TOTAL,
  SONG_DEGREES,
  triadKey,
  type ChapterDefinition,
} from './chapters'

const chapter = (id: string): ChapterDefinition => {
  const found = chapterById(id)
  if (!found) throw new Error(`No chapter: ${id}`)
  return found
}

const labels = (id: string): string[] => chapter(id).combos.map((c) => c.label)

describe('the track (§2.2)', () => {
  it('is 16 chapters with unique ids, keys interleaved with skills', () => {
    expect(CHAPTERS).toHaveLength(16)
    expect(new Set(CHAPTERS.map((c) => c.id)).size).toBe(16)
    expect(CHAPTERS.map((c) => c.kind)).toEqual([
      'key', // C
      'skill', // inversions
      'key', // G
      'key', // F
      'skill', // dominant 7
      'key', // D
      'key', // A
      'skill', // LH root bass
      'key', // E
      'key', // B♭
      'skill', // sus
      'key', // E♭
      'key', // A♭
      'skill', // diminished
      'key', // D♭
      'skill', // sevenths
    ])
  })

  it('orders key chapters around the circle of fifths, alternating sides', () => {
    const keys = CHAPTERS.filter((c) => c.kind === 'key').map((c) => c.key)
    // C · G · F · D · A · E · B♭ · E♭ · A♭ · D♭ (§2.1)
    expect(keys).toEqual([0, 7, 5, 2, 9, 4, 10, 3, 8, 1])
  })

  it('gives every key after C exactly 2 new chords — the +2 property', () => {
    const keyChapters = CHAPTERS.filter((c) => c.kind === 'key')
    expect(keyChapters[0]?.combos).toHaveLength(6) // C
    for (const chapter of keyChapters.slice(1)) {
      expect(chapter.combos, chapter.id).toHaveLength(2)
    }
  })

  it('names key chapters from the key’s conventional tonic', () => {
    expect(
      CHAPTERS.filter((c) => c.kind === 'key').map((c) => c.title),
    ).toEqual([
      'Key of C',
      'Key of G',
      'Key of F',
      'Key of D',
      'Key of A',
      'Key of E',
      'Key of B♭',
      'Key of E♭',
      'Key of A♭',
      'Key of D♭',
    ])
  })

  it('gives every key chapter a song and no skill chapter one (§3.3)', () => {
    for (const chapter of CHAPTERS) {
      if (chapter.kind === 'key') {
        expect(chapter.songDegrees, chapter.id).toEqual(SONG_DEGREES)
        expect(chapter.key, chapter.id).not.toBeNull()
      } else {
        expect(chapter.songDegrees, chapter.id).toBeNull()
        expect(chapter.key, chapter.id).toBeNull()
      }
    }
  })

  it('sings I-IV-V-I', () => {
    expect(SONG_DEGREES).toEqual([0, 3, 4, 0])
  })
})

describe('the 24 triads (§2.1)', () => {
  it('covers every major and minor triad exactly once, and nothing else adds one', () => {
    const triads = new Set<string>()
    for (const chapter of CHAPTERS) {
      for (const { combo } of chapter.combos) {
        if (isPathTriad(combo)) triads.add(triadKey(combo))
      }
    }
    expect(triads.size).toBe(PATH_TRIAD_TOTAL)
    // All 12 roots in both qualities — the whole breadth of the path.
    for (let root = 0; root < 12; root++) {
      expect(triads.has(`${root}:maj`), `${root} maj`).toBe(true)
      expect(triads.has(`${root}:min`), `${root} min`).toBe(true)
    }
  })

  it('counts the triads on key chapters alone — skills are depth, not breadth', () => {
    const fromKeys = new Set<string>()
    const fromSkills = new Set<string>()
    for (const chapter of CHAPTERS) {
      for (const { combo } of chapter.combos) {
        if (!isPathTriad(combo)) continue
        ;(chapter.kind === 'key' ? fromKeys : fromSkills).add(triadKey(combo))
      }
    }
    expect(fromKeys.size).toBe(PATH_TRIAD_TOTAL)
    // Skill chapters only ever re-use a pair a key chapter already counted.
    for (const key of fromSkills) expect(fromKeys.has(key), key).toBe(true)
  })

  it('a skill chapter’s roots are all learned before it opens', () => {
    const learned = new Set<string>()
    for (const chapter of CHAPTERS) {
      if (chapter.kind === 'skill') {
        for (const { combo } of chapter.combos) {
          // Every skill combo builds on a *chord* already passed — the same
          // root and, for voicing skills, the same quality.
          const root = `${combo.root}:maj`
          const minor = `${combo.root}:min`
          expect(
            learned.has(root) || learned.has(minor),
            `${chapter.id}: ${combo.root}`,
          ).toBe(true)
        }
      }
      for (const { combo } of chapter.combos) {
        if (isPathTriad(combo)) learned.add(triadKey(combo))
      }
    }
  })
})

describe('combos and batches (§2.3)', () => {
  it('has no duplicate combo anywhere on the track', () => {
    const all = CHAPTERS.flatMap((c) =>
      c.combos.map((pc) => comboKey(pc.combo)),
    )
    expect(new Set(all).size).toBe(all.length)
    expect(PATH_COMBO_INDEX.size).toBe(all.length)
  })

  it('indexes every combo back to its declaration', () => {
    for (const chapter of CHAPTERS) {
      for (const pathCombo of chapter.combos) {
        expect(PATH_COMBO_INDEX.get(comboKey(pathCombo.combo))).toBe(pathCombo)
      }
    }
  })

  it('partitions each chapter into batches in declared order', () => {
    for (const chapter of CHAPTERS) {
      expect(chapter.batches.flat(), chapter.id).toEqual(chapter.combos)
    }
  })

  it('never leaves a batch empty, over-wide, or alone with one combo', () => {
    for (const chapter of CHAPTERS) {
      for (const [index, batch] of chapter.batches.entries()) {
        const label = `${chapter.id} batch ${index}`
        expect(batch.length, label).toBeGreaterThan(0)
        expect(batch.length, label).toBeLessThanOrEqual(MAX_BATCH_SIZE)
        // A batch of one is massed repetition on the only thing left, which
        // §3.1 rejects — so it is only allowed when the chapter *is* one combo.
        if (batch.length === 1) expect(chapter.combos, label).toHaveLength(1)
      }
    }
  })

  it('opens chapter 1 on I-IV-V, then the minors (§2.3)', () => {
    const first = CHAPTERS[0]
    expect(first?.batches.map((b) => b.map((c) => c.label))).toEqual([
      ['C', 'F', 'G'],
      ['Am', 'Dm', 'Em'],
    ])
  })

  it('maps a combo index to its batch', () => {
    const sus = chapter('sus') // batches of 2
    expect(sus.combos.map((_, i) => batchOfIndex(sus, i))).toEqual([
      0, 0, 1, 1, 2, 2, 3, 3, 4, 4,
    ])
  })
})

describe('voicings over the path’s life (§5.3)', () => {
  it('drills chapter 1 in root position and later keys in any voicing', () => {
    expect(chapter('key-c').combos.map((c) => c.combo.voicingId)).toEqual(
      Array(6).fill('root-position'),
    )
    for (const id of ['key-g', 'key-f', 'key-d', 'key-db']) {
      expect(
        chapter(id).combos.map((c) => c.combo.voicingId),
        id,
      ).toEqual(['any', 'any'])
    }
  })

  it('every combo on the track is satisfiable — none can occupy a dead slot', () => {
    for (const chapter of CHAPTERS) {
      for (const { combo, label } of chapter.combos) {
        const rule = BUILT_IN_VOICING_LIBRARY.get(combo.voicingId)
        expect(rule, `${chapter.id}: ${label}`).toBeDefined()
        if (!rule) continue
        expect(
          realizeVoicing(
            { root: combo.root, type: getChordType(combo.typeId) },
            rule,
          ),
          `${chapter.id}: ${label}`,
        ).not.toBeNull()
      }
    }
  })
})

describe('labels and spelling (§3.5)', () => {
  it('spells roots from the chapter’s key, not the default root policy', () => {
    // The three the default policy gets "wrong" — this is why chapters declare
    // (key, degree) rather than a pitch class.
    expect(labels('key-ab')).toEqual(['D♭', 'B♭m']) // IV of A♭ is D♭, not C♯
    expect(labels('key-db')).toEqual(['G♭', 'E♭m']) // IV of D♭ is G♭, not F♯
    expect(labels('diminished')).toContain('D♯°') // vii° of E is D♯, not E♭
  })

  it('names an inversion as its slash chord (§2.2)', () => {
    expect(labels('inversions-c')).toEqual([
      'C/E',
      'F/A',
      'G/B',
      'C/G',
      'F/C',
      'G/D',
    ])
  })

  it('leaves root position and `any` unadorned — the chord name is the name', () => {
    expect(labels('key-c')).toEqual(['C', 'F', 'G', 'Am', 'Dm', 'Em'])
    expect(labels('key-g')).toEqual(['D', 'Bm'])
  })

  it('names chord qualities compactly', () => {
    expect(labels('dominant-7')).toEqual(['G7', 'D7', 'C7'])
    expect(labels('sus').slice(0, 2)).toEqual(['Csus2', 'Csus4'])
    expect(labels('sevenths').slice(0, 4)).toEqual([
      'Cmaj7',
      'Gmaj7',
      'Fmaj7',
      'Dm7',
    ])
  })

  it('names a pattern rule by its hand shape, so it can’t collide with the plain chord', () => {
    expect(labels('lh-root-bass')[0]).toBe('C · 1 + 1-3-5')
    // The same chord in root position is a different combo with a different
    // label — which the repertoire row depends on (§4.1).
    expect(labels('key-c')[0]).toBe('C')
  })

  it('every label is unique across the track', () => {
    const all = CHAPTERS.flatMap((c) => c.combos.map((pc) => pc.label))
    expect(new Set(all).size).toBe(all.length)
  })

  it('blurbs the contents of every chapter', () => {
    for (const chapter of CHAPTERS) {
      expect(chapter.blurb, chapter.id).not.toBe('')
    }
    expect(chapter('key-c').blurb).toBe('C · F · G · Am · Dm · Em')
  })
})

describe('degree arithmetic', () => {
  it('resolves every declared root from its key and degree', () => {
    for (const chapter of CHAPTERS) {
      for (const pathCombo of chapter.combos) {
        expect(isValidDegree(pathCombo.degree), chapter.id).toBe(true)
        expect(pathCombo.combo.root, pathCombo.label).toBe(
          degreeRoot(pathCombo.key, pathCombo.degree),
        )
        // The spelling and the combo agree on the pitch, always.
        expect(pathCombo.spelling.pc, pathCombo.label).toBe(
          pathCombo.combo.root,
        )
      }
    }
  })

  it('rejects a degree outside the major scale', () => {
    expect(isValidDegree(-1)).toBe(false)
    expect(isValidDegree(7)).toBe(false)
    expect(isValidDegree(1.5)).toBe(false)
    expect(isValidDegree(0)).toBe(true)
    expect(isValidDegree(6)).toBe(true)
  })

  it('spells what it resolves', () => {
    const bFlatFour = chapter('key-f').combos[0]
    expect(bFlatFour && formatSpelling(bFlatFour.spelling)).toBe('B♭')
  })
})
