import { describe, expect, it } from 'vitest'
import { createPrompt, expandPreset, type Preset } from '../practice'
import { matches, voicingLibrary, type VoicingRule } from '../theory'
import { AppStorage, type KeyValueStore } from '../storage'
import { createLibraryStore, type LibraryMemory } from './libraryStore'

function fakeKV(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    get: (key) => data.get(key) ?? null,
    set(key, value) {
      data.set(key, value)
      return true
    },
    remove(key) {
      data.delete(key)
    },
  }
}

function storageMemory(storage: AppStorage): LibraryMemory {
  return {
    load: () => ({
      rules: storage.state.customVoicingRules,
      presets: storage.state.customPresets,
    }),
    save: (rules, presets) =>
      storage.update((state) => ({
        ...state,
        customVoicingRules: [...rules],
        customPresets: [...presets],
      })),
  }
}

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
  pool: { kind: 'product', roots: [0, 5], chordTypes: ['maj7', 'dom7'] },
  voicingIds: ['rule-wide'],
}

describe('libraryStore', () => {
  it('persists saves and edits through the storage', () => {
    const kv = fakeKV()
    const store = createLibraryStore(storageMemory(new AppStorage(kv)))
    expect(store.getState().saveRule(rule)).toBe(true)
    expect(store.getState().savePreset(preset)).toBe(true)
    // Replace-by-id keeps position and identity.
    expect(store.getState().saveRule({ ...rule, name: 'Wider' })).toBe(true)
    expect(store.getState().customRules).toEqual([{ ...rule, name: 'Wider' }])

    // A fresh AppStorage over the same backend sees everything.
    const reloaded = createLibraryStore(storageMemory(new AppStorage(kv)))
    expect(reloaded.getState().customRules).toEqual([
      { ...rule, name: 'Wider' },
    ])
    expect(reloaded.getState().customPresets).toEqual([preset])
  })

  it('rejects saves that do not survive sanitizing', () => {
    const store = createLibraryStore(storageMemory(new AppStorage(fakeKV())))
    expect(store.getState().saveRule({ ...rule, name: '   ' })).toBe(false)
    expect(
      store.getState().savePreset({ ...preset, voicingIds: ['rule-gone'] }),
    ).toBe(false)
    expect(store.getState().customRules).toEqual([])
    expect(store.getState().customPresets).toEqual([])
  })

  it('blocks deleting a rule while a preset references it', () => {
    const store = createLibraryStore(storageMemory(new AppStorage(fakeKV())))
    store.getState().saveRule(rule)
    store.getState().savePreset(preset)
    expect(store.getState().deleteRule(rule.id)).toBe(false)
    expect(store.getState().customRules).toHaveLength(1)

    store.getState().deletePreset(preset.id)
    expect(store.getState().deleteRule(rule.id)).toBe(true)
    expect(store.getState().customRules).toEqual([])
  })

  // The Phase 9 milestone: export from one browser profile, import in a
  // fresh one, and the custom preset drills identically.
  it('export → import into a fresh profile drills identically', () => {
    const source = createLibraryStore(storageMemory(new AppStorage(fakeKV())))
    source.getState().saveRule(rule)
    source.getState().savePreset(preset)
    const json = source.getState().exportJson()

    const target = createLibraryStore(storageMemory(new AppStorage(fakeKV())))
    const result = target.getState().importJson(json)
    expect(result.ok).toBe(true)
    expect(target.getState().customRules).toEqual([rule])
    expect(target.getState().customPresets).toEqual([preset])

    // Both profiles expand the preset to the same combos, and a prompt
    // realizes against the imported custom rule.
    const sourceLib = voicingLibrary(source.getState().customRules)
    const targetLib = voicingLibrary(target.getState().customRules)
    const sourceCombos = expandPreset(preset, sourceLib).combos
    const targetCombos = expandPreset(preset, targetLib).combos
    expect(targetCombos).toEqual(sourceCombos)
    expect(targetCombos.length).toBeGreaterThan(0)

    const combo = targetCombos[0]!
    const prompt = createPrompt(combo, undefined, targetLib)
    expect(prompt.voicing).toEqual(rule)
    expect(matches(prompt.example, prompt.chord, prompt.voicing)).toBe(true)

    // Importing the same file again changes nothing and reports why.
    const again = target.getState().importJson(json)
    expect(again.ok && again.plan.alreadyPresent.sort()).toEqual(
      [preset.name, rule.name].sort(),
    )
    expect(target.getState().customRules).toHaveLength(1)
  })
})
