import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_VOICING_RULES,
  voicingLibrary,
  type ChordTypeId,
  type VoicingRule,
} from '../theory'
import { newLibraryId, presetWarnings } from './library'
import type { Preset } from './presets'

const bassOn7th: VoicingRule = {
  id: 'rule-7th',
  name: 'Bass on the 7th',
  bass: { kind: 'chordTone', degree: 3 },
  doubling: 'allowed',
}

describe('voicingLibrary', () => {
  it('serves built-ins with no customs', () => {
    const lib = voicingLibrary()
    expect(lib.rules).toEqual(BUILT_IN_VOICING_RULES)
    expect(lib.get('any')?.name).toBe('Any Voicing')
    expect(lib.get('nope')).toBeUndefined()
  })

  it('appends custom rules after the built-ins', () => {
    const lib = voicingLibrary([bassOn7th])
    expect(lib.get('rule-7th')).toEqual(bassOn7th)
    expect(lib.rules.at(-1)).toEqual(bassOn7th)
    expect(lib.rules).toHaveLength(BUILT_IN_VOICING_RULES.length + 1)
  })

  it('a built-in wins an id collision', () => {
    const impostor: VoicingRule = { ...bassOn7th, id: 'closed' }
    const lib = voicingLibrary([impostor])
    expect(lib.get('closed')?.name).toBe('Closed Position')
    expect(lib.rules).toHaveLength(BUILT_IN_VOICING_RULES.length)
  })
})

describe('newLibraryId', () => {
  it('prefixes and avoids taken ids', () => {
    // A constant rng always proposes the same id; the taken set must force
    // the retry loop to be visible, so feed a sequence instead.
    const values = [0.5, 0.5, 0.75]
    const rng = () => values.shift() ?? 0.9
    const first = newLibraryId('rule', new Set(), () => 0.5)
    expect(first.startsWith('rule-')).toBe(true)
    const second = newLibraryId('rule', new Set([first]), rng)
    expect(second).not.toBe(first)
    expect(second.startsWith('rule-')).toBe(true)
  })
})

describe('presetWarnings (§4)', () => {
  const preset = (
    chordTypes: readonly ChordTypeId[],
    voicingIds: readonly string[],
  ): Preset => ({
    id: 'p',
    name: 'P',
    pool: { kind: 'product', roots: [0], chordTypes },
    voicingIds,
  })

  it('is silent for a compatible preset', () => {
    expect(presetWarnings(preset(['maj'], ['any']), voicingLibrary())).toEqual(
      [],
    )
    // dom13 vs open: satisfiable, no span max — no warning either.
    expect(
      presetWarnings(preset(['dom13'], ['open']), voicingLibrary()),
    ).toEqual([])
  })

  it('flags chord types that cannot satisfy a rule', () => {
    // Triads have no 4th chord tone, so a bass-on-the-7th rule never lands.
    const warnings = presetWarnings(
      preset(['maj'], ['rule-7th']),
      voicingLibrary([bassOn7th]),
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.kind).toBe('unsatisfiable')
    expect(warnings[0]?.typeId).toBe('maj')
    expect(warnings[0]?.message).toContain('Major')
  })

  it('flags the §4 dom13-vs-closed case as cluster-only', () => {
    const warnings = presetWarnings(
      preset(['dom13'], ['closed']),
      voicingLibrary(),
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.kind).toBe('cluster-only')
    expect(warnings[0]?.message).toContain('cluster')
  })

  it('flags a reference to a missing rule once', () => {
    const warnings = presetWarnings(
      preset(['maj', 'min'], ['rule-gone']),
      voicingLibrary(),
    )
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.kind).toBe('missing-rule')
    expect(warnings[0]?.typeId).toBeNull()
  })
})
