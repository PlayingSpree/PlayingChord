import { describe, expect, it } from 'vitest'
import type { Preset } from '../practice'
import type { VoicingRule } from '../theory'
import { exportLibraryJson, planImport } from './importExport'
import { SCHEMA_VERSION } from './schema'

const rule: VoicingRule = {
  id: 'rule-wide',
  name: 'Wide root',
  bass: { kind: 'chordTone', degree: 0 },
  span: { min: 12 },
  doubling: 'exact',
}

const preset: Preset = {
  id: 'preset-jazz',
  name: 'Jazz sevenths',
  pool: { kind: 'product', roots: [0, 5, 7], chordTypes: ['maj7', 'dom7'] },
  voicingIds: ['any', 'rule-wide'],
}

describe('exportLibraryJson / planImport (§4)', () => {
  it('round-trips a library into an empty profile', () => {
    const json = exportLibraryJson([rule], [preset])
    const parsed = JSON.parse(json) as { kind: string; version: number }
    expect(parsed.kind).toBe('playingchord-library')
    expect(parsed.version).toBe(SCHEMA_VERSION)

    const result = planImport(json, [], [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.voicingRules).toEqual([rule])
    expect(result.plan.presets).toEqual([preset])
    expect(result.plan.conflicts).toEqual([])
    expect(result.plan.alreadyPresent).toEqual([])
    expect(result.plan.invalid).toBe(0)
  })

  it('rejects junk, wrong kinds, and newer schema versions', () => {
    expect(planImport('not json', [], []).ok).toBe(false)
    expect(planImport('{"kind":"other"}', [], []).ok).toBe(false)
    expect(planImport('[1,2,3]', [], []).ok).toBe(false)
    const newer = JSON.stringify({
      kind: 'playingchord-library',
      version: SCHEMA_VERSION + 1,
      voicingRules: [],
      presets: [],
    })
    const result = planImport(newer, [], [])
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('newer')
  })

  it('skips identical items and reports differing collisions as conflicts', () => {
    const json = exportLibraryJson([rule], [preset])
    const localVariant: Preset = { ...preset, name: 'Renamed locally' }
    const result = planImport(json, [rule], [localVariant])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The identical rule is skipped silently-but-reported; the differing
    // preset is a conflict and the local version wins.
    expect(result.plan.voicingRules).toEqual([])
    expect(result.plan.presets).toEqual([])
    expect(result.plan.alreadyPresent).toEqual([rule.name])
    expect(result.plan.conflicts).toEqual([preset.name])
  })

  it('drops invalid entries and counts them', () => {
    const json = JSON.stringify({
      kind: 'playingchord-library',
      version: 1,
      voicingRules: [rule, { id: 'closed', name: 'Shadow' }],
      presets: [preset, 'junk'],
    })
    const result = planImport(json, [], [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.voicingRules).toEqual([rule])
    expect(result.plan.presets).toEqual([preset])
    expect(result.plan.invalid).toBe(2)
  })

  it('keeps preset references valid when the referenced rule conflicts', () => {
    // Locally, rule-wide exists with different content; the incoming preset
    // referencing rule-wide must still import (the id resolves locally).
    const localRule: VoicingRule = { ...rule, doubling: 'allowed' }
    const json = exportLibraryJson([rule], [preset])
    const result = planImport(json, [localRule], [])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.conflicts).toEqual([rule.name])
    expect(result.plan.presets).toEqual([preset])
  })
})
