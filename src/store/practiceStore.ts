import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import {
  AttemptLifecycle,
  builtInPresets,
  comboKey,
  comboLabel,
  createPrompt,
  DEFAULT_DIATONIC_KEY,
  expandPreset,
  pickWeightedCombo,
  rankWorstCombos,
  RECENT_WINDOW,
  type AttemptPhase,
  type Combo,
  type ComboStatsSource,
  type ExpandedPreset,
  type Hint,
  type PracticeSettings,
  type Preset,
  type Prompt,
  type PromptOutcome,
  type Rng,
} from '../practice'
import type { PitchClass } from '../theory'
import { appStorage, PersistedComboStats } from '../storage'
import { settingsStore } from './settingsStore'

// Selected preset + diatonic key, remembered like the MIDI device — in the
// versioned schema (§8); the Phase 5 plain key migrates on first load.
export interface PresetSelection {
  presetId: string
  diatonicKey: PitchClass
}

export interface PresetMemory {
  load(): Partial<PresetSelection> | null
  save(selection: PresetSelection): void
}

export const persistedPresetMemory: PresetMemory = {
  load: () => appStorage.state.presetSelection,
  save: (selection) =>
    appStorage.update((state) => ({ ...state, presetSelection: selection })),
}

function sanitizeDiatonicKey(value: unknown): PitchClass {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 11
    ? value
    : DEFAULT_DIATONIC_KEY
}

// Live session tallies for the §7 stats bar, reset on reload (a "session"
// is one app load). Skips never count; time-to-correct includes retries.
export interface SessionStats {
  prompts: number
  firstTrySuccesses: number
  totalTimeToCorrectMs: number
}

const FRESH_SESSION: SessionStats = {
  prompts: 0,
  firstTrySuccesses: 0,
  totalTimeToCorrectMs: 0,
}

// A §7 "worst chords" row, ready for display.
export interface WorstChordEntry {
  key: string
  label: string
  // Lifetime first-try accuracy (§7: first-try successes ÷ prompts).
  accuracy: number
}

// Thin adapter over the pure practice engine: picks weighted prompts from
// the selected preset, feeds held-set changes into the §6.2 machine, mirrors
// machine state out for the UI, and records prompt outcomes into the
// persisted stats (§7: skips excluded; miss = any miss before the eventual
// correct).
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
  session: SessionStats
  // Worst combos of the current preset from the *persisted* records, so the
  // list survives reloads (Milestone B) unlike the session tallies.
  worstChords: readonly WorstChordEntry[]
  start(): void
  onHeldChange(held: ReadonlySet<number>): void
  skip(): void
  setPreset(id: string): void
  setDiatonicKey(key: PitchClass): void
}

export interface PracticeStoreDeps {
  presets?: (diatonicKey: PitchClass) => readonly Preset[]
  stats?: ComboStatsSource
  memory?: PresetMemory
  rng?: Rng
  now?: () => number
  settings?: () => PracticeSettings
}

export function createPracticeStore({
  presets = builtInPresets,
  stats = new PersistedComboStats(appStorage),
  memory = persistedPresetMemory,
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

    // The §7 worst-chords list for the current pool, from persisted records.
    const worstChords = (): WorstChordEntry[] =>
      rankWorstCombos(expansion.combos, stats).map(({ combo, record }) => ({
        key: comboKey(combo),
        label: comboLabel(combo, expansion.rootSpellings.get(combo.root)),
        accuracy: record.firstTrySuccesses / record.attempts,
      }))

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
      set({
        prompt,
        missedRecently: misses > 0 ? misses : null,
        worstChords: worstChords(),
      })
      machine.promptShown(prompt)
    }

    // A prompt only completes through the 'advancing' phase — skip advances
    // from any other phase and stays out of stats and weighting (§6.2 step 4).
    const recordOutcome = () => {
      if (currentCombo === null || machine.state.phase !== 'advancing') return
      const outcome: PromptOutcome =
        machine.state.missCount > 0 ? 'missed' : 'first-try'
      const timeToCorrectMs = machine.state.reactionMs ?? 0
      stats.record(comboKey(currentCombo), outcome, timeToCorrectMs)
      set((state) => ({
        session: {
          prompts: state.session.prompts + 1,
          firstTrySuccesses:
            state.session.firstTrySuccesses + (outcome === 'first-try' ? 1 : 0),
          totalTimeToCorrectMs:
            state.session.totalTimeToCorrectMs + timeToCorrectMs,
        },
      }))
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
      session: FRESH_SESSION,
      worstChords: [],

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
