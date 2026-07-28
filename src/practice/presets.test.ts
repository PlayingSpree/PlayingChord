import { describe, expect, it } from 'vitest'
import {
  matches,
  pitchClass,
  voicingLibrary,
  type VoicingRule,
} from '../theory'
import { comboKey, type Combo } from './combos'
import { createPrompt } from './prompts'
import {
  builtInPresets,
  expandPreset,
  poolChords,
  type Preset,
} from './presets'

const byId = (id: string): Preset => {
  const preset = builtInPresets().find((p) => p.id === id)
  if (!preset) throw new Error(`No built-in preset: ${id}`)
  return preset
}

describe('pool expansion (§4/§5)', () => {
  it('product pools cross roots × chord types × voicings', () => {
    const preset: Preset = {
      id: 'test',
      name: 'Test',
      pool: { kind: 'product', roots: [0, 5], chordTypes: ['maj', 'min7'] },
      voicingIds: ['any', 'root-position'],
    }
    const { combos } = expandPreset(preset)
    expect(combos).toHaveLength(2 * 2 * 2)
    expect(new Set(combos.map(comboKey)).size).toBe(8)
    expect(combos).toContainEqual({
      root: 5,
      typeId: 'min7',
      voicingId: 'root-position',
    })
  })

  it('drops combos whose rule is missing or unsatisfiable (Phase 9)', () => {
    const bassOn7th: VoicingRule = {
      id: 'rule-7th',
      name: 'Bass on the 7th',
      bass: { kind: 'chordTone', degree: 3 },
      doubling: 'allowed',
    }
    const preset: Preset = {
      id: 'test',
      name: 'Test',
      pool: { kind: 'product', roots: [0, 7], chordTypes: ['maj', 'maj7'] },
      voicingIds: ['rule-7th', 'rule-gone'],
    }
    const { combos } = expandPreset(preset, voicingLibrary([bassOn7th]))
    // Triads have no 4th tone and 'rule-gone' resolves to nothing — only
    // maj7 × rule-7th survives, for both roots.
    expect(combos).toEqual([
      { root: 0, typeId: 'maj7', voicingId: 'rule-7th' },
      { root: 7, typeId: 'maj7', voicingId: 'rule-7th' },
    ])
    // Nothing satisfiable at all → an empty expansion, not a crash.
    const hopeless: Preset = {
      ...preset,
      pool: { kind: 'product', roots: [0], chordTypes: ['maj'] },
    }
    expect(expandPreset(hopeless, voicingLibrary([bassOn7th])).combos).toEqual(
      [],
    )
  })

  it('explicit pools expand exactly the listed chords', () => {
    const preset: Preset = {
      id: 'test',
      name: 'Test',
      pool: {
        kind: 'explicit',
        chords: [
          { root: 0, typeId: 'maj' },
          { root: 9, typeId: 'min' },
        ],
      },
      voicingIds: ['any'],
    }
    expect(expandPreset(preset).combos).toEqual([
      { root: 0, typeId: 'maj', voicingId: 'any' },
      { root: 9, typeId: 'min', voicingId: 'any' },
    ])
  })

  it('diatonic pools give I ii iii IV V vi vii° of the major key', () => {
    expect(poolChords({ kind: 'diatonic', key: 0 })).toEqual([
      { root: 0, typeId: 'maj' }, // C
      { root: 2, typeId: 'min' }, // Dm
      { root: 4, typeId: 'min' }, // Em
      { root: 5, typeId: 'maj' }, // F
      { root: 7, typeId: 'maj' }, // G
      { root: 9, typeId: 'min' }, // Am
      { root: 11, typeId: 'dim' }, // B°
    ])
  })

  it('diatonic roots wrap around the octave', () => {
    const roots = poolChords({ kind: 'diatonic', key: 9 }).map((c) => c.root)
    expect(roots).toEqual([9, 11, 1, 2, 4, 6, 8]) // A major: A B C♯ D E F♯ G♯
  })
})

// The pool the derived Repertoire preset uses (§3.2/§4): per-chord voicings,
// which no other pool kind can express.
describe('combos pools (§4)', () => {
  const preset = (combos: readonly Combo[], voicingIds = ['any']): Preset => ({
    id: 'p',
    name: 'p',
    pool: { kind: 'combos', combos },
    voicingIds,
  })

  it('expands to exactly its combos, per-chord voicings intact', () => {
    const combos: Combo[] = [
      { root: 0, typeId: 'maj', voicingId: 'first-inversion' },
      { root: 7, typeId: 'maj', voicingId: 'root-position' },
    ]
    expect(expandPreset(preset(combos)).combos).toEqual(combos)
  })

  it('ignores the preset’s voicingIds rather than crossing them in', () => {
    const combos: Combo[] = [{ root: 0, typeId: 'maj', voicingId: 'any' }]
    // `voicingIds` naming two other rules changes nothing — the pool decides.
    const expanded = expandPreset(
      preset(combos, ['first-inversion', 'second-inversion']),
    )
    expect(expanded.combos).toEqual(combos)
  })

  it('drops unsatisfiable combos like every other pool', () => {
    // lh-root names a third; sus2 has none (§3.3 pattern rules).
    const expanded = expandPreset(
      preset([
        { root: 0, typeId: 'maj', voicingId: 'lh-root' },
        { root: 0, typeId: 'sus2', voicingId: 'lh-root' },
      ]),
    )
    expect(expanded.combos).toEqual([
      { root: 0, typeId: 'maj', voicingId: 'lh-root' },
    ])
  })

  it('drops back to deduped chords, so Song mode can read it', () => {
    expect(
      poolChords({
        kind: 'combos',
        combos: [
          { root: 0, typeId: 'maj', voicingId: 'root-position' },
          { root: 0, typeId: 'maj', voicingId: 'first-inversion' },
          { root: 9, typeId: 'min', voicingId: 'any' },
        ],
      }),
    ).toEqual([
      { root: 0, typeId: 'maj' },
      { root: 9, typeId: 'min' },
    ])
  })

  it('has no root-spelling overrides — the path supplies its own', () => {
    expect(
      expandPreset(preset([{ root: 0, typeId: 'maj', voicingId: 'any' }]))
        .rootSpellings.size,
    ).toBe(0)
  })
})

describe('diatonic root spelling from the key (§3.5)', () => {
  const displayNames = (key: number): string[] => {
    const preset: Preset = {
      id: 'test',
      name: 'Test',
      pool: { kind: 'diatonic', key },
      voicingIds: ['any'],
    }
    const { combos, rootSpellings } = expandPreset(preset)
    return combos.map(
      (combo) => createPrompt(combo, rootSpellings.get(combo.root)).displayName,
    )
  }

  it('B major spells sharps the default policy would flat', () => {
    expect(displayNames(11)).toEqual([
      'B maj',
      'C♯ min',
      'D♯ min', // default policy would say E♭
      'E maj',
      'F♯ maj',
      'G♯ min', // default policy would say A♭
      'A♯ dim', // default policy would say B♭
    ])
  })

  it('D♭ major spells G♭, not the default F♯', () => {
    expect(displayNames(1)).toEqual([
      'D♭ maj',
      'E♭ min',
      'F min',
      'G♭ maj',
      'A♭ maj',
      'B♭ min',
      'C dim',
    ])
  })

  it('non-diatonic pools have no root-spelling overrides', () => {
    expect(expandPreset(byId('major-triads')).rootSpellings.size).toBe(0)
  })
})

describe('built-in presets (§4)', () => {
  it('has the 7 presets with unique ids', () => {
    const presets = builtInPresets()
    expect(presets.map((p) => p.id)).toEqual([
      'major-triads',
      'minor-triads',
      'major-minor-triads',
      'seventh-chords',
      'triad-qualities',
      'diatonic',
      'inversion-drills',
    ])
  })

  it.each([
    ['major-triads', 12],
    ['minor-triads', 12],
    ['major-minor-triads', 24],
    ['seventh-chords', 36],
    ['triad-qualities', 72],
    ['diatonic', 7],
    ['inversion-drills', 48],
  ])('%s expands to %i combos', (id, count) => {
    expect(expandPreset(byId(id)).combos).toHaveLength(count)
  })

  it('inversion drills use the inversion rules, never `any`', () => {
    const voicings = new Set(
      expandPreset(byId('inversion-drills')).combos.map((c) => c.voicingId),
    )
    expect([...voicings].sort()).toEqual([
      'first-inversion',
      'second-inversion',
    ])
  })

  it('the diatonic preset takes its key from the picker', () => {
    const diatonic = builtInPresets(4).find((p) => p.id === 'diatonic')
    expect(diatonic?.pool).toEqual({ kind: 'diatonic', key: 4 })
    expect(builtInPresets(15).find((p) => p.id === 'diatonic')?.pool).toEqual({
      kind: 'diatonic',
      key: pitchClass(15),
    })
  })

  it('every combo of every preset (all 12 diatonic keys) is satisfiable', () => {
    const keys = Array.from({ length: 12 }, (_, key) => key)
    for (const key of keys) {
      for (const preset of builtInPresets(key)) {
        const { combos, rootSpellings } = expandPreset(preset)
        for (const combo of combos) {
          const prompt = createPrompt(combo, rootSpellings.get(combo.root))
          expect(matches(prompt.example, prompt.chord, prompt.voicing)).toBe(
            true,
          )
        }
      }
    }
  })
})
