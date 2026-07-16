import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import {
  AttemptLifecycle,
  comboKey,
  createPrompt,
  pickCombo,
  MAJOR_TRIADS_COMBOS,
  RECENT_WINDOW,
  type AttemptPhase,
  type Combo,
  type Hint,
  type PracticeSettings,
  type Prompt,
  type Rng,
} from '../practice'
import { settingsStore } from './settingsStore'

// Thin adapter over the pure §6.2 state machine (practice/lifecycle.ts):
// picks prompts, feeds held-set changes in, mirrors machine state out for
// the UI. All judging, stall, and hint logic lives in practice/.
export interface PracticeStoreState {
  prompt: Prompt | null
  phase: AttemptPhase
  // Prompt shown → correct match (§7); displayed with the ✔ flash.
  reactionMs: number | null
  missCount: number
  hint: Hint | null
  start(): void
  onHeldChange(held: ReadonlySet<number>): void
  skip(): void
}

export interface PracticeStoreDeps {
  pool?: readonly Combo[]
  rng?: Rng
  now?: () => number
  settings?: () => PracticeSettings
}

export function createPracticeStore({
  pool = MAJOR_TRIADS_COMBOS,
  rng = Math.random,
  now = Date.now,
  settings = () => settingsStore.getState().settings,
}: PracticeStoreDeps = {}) {
  const recentKeys: string[] = []

  return createStore<PracticeStoreState>()((set, get) => {
    const nextPrompt = () => {
      const combo = pickCombo(pool, recentKeys, rng)
      recentKeys.push(comboKey(combo))
      if (recentKeys.length > RECENT_WINDOW) recentKeys.shift()
      const prompt = createPrompt(combo)
      set({ prompt })
      machine.promptShown(prompt)
    }

    const machine = new AttemptLifecycle({
      settings,
      now,
      onState: (state) => set(state),
      onAdvance: () => nextPrompt(),
    })

    return {
      prompt: null,
      phase: 'idle',
      reactionMs: null,
      missCount: 0,
      hint: null,

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
    }
  })
}

export const practiceStore = createPracticeStore()

export function usePractice<T>(selector: (state: PracticeStoreState) => T): T {
  return useStore(practiceStore, selector)
}
