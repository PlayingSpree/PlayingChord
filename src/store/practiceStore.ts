import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import {
  AttemptLifecycle,
  builtInPresets,
  comboKey,
  createPrompt,
  DEFAULT_DIATONIC_KEY,
  expandPreset,
  InMemoryRecentStats,
  pickWeightedCombo,
  RECENT_WINDOW,
  type AttemptPhase,
  type Combo,
  type ExpandedPreset,
  type Hint,
  type PracticeSettings,
  type Preset,
  type Prompt,
  type Rng,
} from '../practice'
import type { PitchClass } from '../theory'
import { settingsStore } from './settingsStore'

// Selected preset + diatonic key, remembered like the MIDI device: a plain
// localStorage key that migrates into the Phase 6 versioned schema.
export interface PresetSelection {
  presetId: string
  diatonicKey: PitchClass
}

export interface PresetMemory {
  load(): Partial<PresetSelection> | null
  save(selection: PresetSelection): void
}

const STORAGE_KEY = 'playingchord:preset'

export const localStoragePresetMemory: PresetMemory = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      return raw ? (JSON.parse(raw) as Partial<PresetSelection>) : null
    } catch {
      return null
    }
  },
  save(selection) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
    } catch {
      // Private-mode or quota failures just lose the persistence.
    }
  },
}

function sanitizeDiatonicKey(value: unknown): PitchClass {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 11
    ? value
    : DEFAULT_DIATONIC_KEY
}

// Thin adapter over the pure practice engine: picks weighted prompts from
// the selected preset, feeds held-set changes into the §6.2 machine, mirrors
// machine state out for the UI, and records prompt outcomes into the stats
// stub (§7: skips excluded; miss = any miss before the eventual correct).
export interface PracticeStoreState {
  presets: readonly Preset[]
  presetId: string
  diatonicKey: PitchClass
  prompt: Prompt | null
  phase: AttemptPhase
  // Prompt shown → correct match (§7); displayed with the ✔ flash.
  reactionMs: number | null
  missCount: number
  hint: Hint | null
  // Recent misses of the current prompt's combo — drives the 🔥 "Practicing"
  // indicator (§5/§7); null when there are none.
  missedRecently: number | null
  start(): void
  onHeldChange(held: ReadonlySet<number>): void
  skip(): void
  setPreset(id: string): void
  setDiatonicKey(key: PitchClass): void
}

export interface PracticeStoreDeps {
  presets?: (diatonicKey: PitchClass) => readonly Preset[]
  stats?: InMemoryRecentStats
  memory?: PresetMemory
  rng?: Rng
  now?: () => number
  settings?: () => PracticeSettings
}

export function createPracticeStore({
  presets = builtInPresets,
  stats = new InMemoryRecentStats(),
  memory = localStoragePresetMemory,
  rng = Math.random,
  now = Date.now,
  settings = () => settingsStore.getState().settings,
}: PracticeStoreDeps = {}) {
  let recentKeys: string[] = []
  let currentCombo: Combo | null = null

  const remembered = memory.load()
  const initialKey = sanitizeDiatonicKey(remembered?.diatonicKey)
  const initialPresets = presets(initialKey)
  const fallback = initialPresets[0]
  if (!fallback) throw new Error('No presets defined')
  const initialId = initialPresets.some((p) => p.id === remembered?.presetId)
    ? (remembered?.presetId ?? fallback.id)
    : fallback.id

  return createStore<PracticeStoreState>()((set, get) => {
    const resolve = (presetId: string, diatonicKey: PitchClass) => {
      const list = presets(diatonicKey)
      const preset = list.find((p) => p.id === presetId) ?? list[0]
      if (!preset) throw new Error('No presets defined')
      return { list, preset, expansion: expandPreset(preset) }
    }

    let expansion: ExpandedPreset = resolve(initialId, initialKey).expansion

    const nextPrompt = () => {
      const combo = pickWeightedCombo(expansion.combos, recentKeys, stats, rng)
      currentCombo = combo
      recentKeys.push(comboKey(combo))
      if (recentKeys.length > RECENT_WINDOW) recentKeys.shift()
      const prompt = createPrompt(
        combo,
        expansion.rootSpellings.get(combo.root),
      )
      const misses = stats.recentHistory(comboKey(combo))?.misses ?? 0
      set({ prompt, missedRecently: misses > 0 ? misses : null })
      machine.promptShown(prompt)
    }

    // A prompt only completes through the 'advancing' phase — skip advances
    // from any other phase and stays out of stats and weighting (§6.2 step 4).
    const recordOutcome = () => {
      if (currentCombo === null || machine.state.phase !== 'advancing') return
      stats.record(
        comboKey(currentCombo),
        machine.state.missCount > 0 ? 'missed' : 'first-try',
      )
    }

    const machine = new AttemptLifecycle({
      settings,
      now,
      onState: (state) => set(state),
      onAdvance: () => {
        recordOutcome()
        nextPrompt()
      },
    })

    const applySelection = (presetId: string, diatonicKey: PitchClass) => {
      // A correct prompt still waiting out its advance timer counts; the
      // timer itself dies with the next promptShown().
      recordOutcome()
      const { list, preset, expansion: next } = resolve(presetId, diatonicKey)
      expansion = next
      recentKeys = []
      memory.save({ presetId: preset.id, diatonicKey })
      set({ presets: list, presetId: preset.id, diatonicKey })
      nextPrompt()
    }

    return {
      presets: initialPresets,
      presetId: initialId,
      diatonicKey: initialKey,
      prompt: null,
      phase: 'idle',
      reactionMs: null,
      missCount: 0,
      hint: null,
      missedRecently: null,

      start() {
        if (get().prompt !== null) return // React StrictMode mounts effects twice
        nextPrompt()
      },

      onHeldChange(held: ReadonlySet<number>) {
        machine.heldChange(held)
      },

      skip() {
        machine.skip()
      },

      setPreset(id: string) {
        if (id === get().presetId) return
        if (!get().presets.some((p) => p.id === id)) return
        applySelection(id, get().diatonicKey)
      },

      setDiatonicKey(key: PitchClass) {
        const sanitized = sanitizeDiatonicKey(key)
        if (sanitized === get().diatonicKey) return
        const active = get().presets.find((p) => p.id === get().presetId)
        if (active?.pool.kind === 'diatonic') {
          applySelection(get().presetId, sanitized)
        } else {
          // Key picker is only shown for the diatonic preset, but keep the
          // state coherent if it's ever set another way.
          memory.save({ presetId: get().presetId, diatonicKey: sanitized })
          set({ diatonicKey: sanitized, presets: presets(sanitized) })
        }
      },
    }
  })
}

export const practiceStore = createPracticeStore()

export function usePractice<T>(selector: (state: PracticeStoreState) => T): T {
  return useStore(practiceStore, selector)
}
