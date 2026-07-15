import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { matches } from '../theory'
import {
  comboKey,
  createPrompt,
  pickCombo,
  MAJOR_TRIADS_COMBOS,
  RECENT_WINDOW,
  type Combo,
  type Prompt,
  type Rng,
} from '../practice'

// Phase 3 walking skeleton: correct-path only (wrong input does nothing).
// Phase 4 replaces this with the full §6.2 lifecycle (miss, stall, hints,
// skip) as a pure state machine in practice/.
//
// - 'awaiting-release': prompt shown, but keys are still down — an attempt
//   arms only once all keys are released, so held-over notes from the
//   previous prompt are never judged against the new one (§6.2 step 1).
// - 'armed': judging on every held-set change.
// - 'advancing': ✔ shown; input is ignored until auto-advance fires.
export type PracticePhase = 'idle' | 'awaiting-release' | 'armed' | 'advancing'

// Becomes a configurable setting in Phase 4 (§6.2).
export const AUTO_ADVANCE_MS = 800

export interface PracticeStoreState {
  prompt: Prompt | null
  phase: PracticePhase
  // Prompt shown → correct match (§7); displayed with the ✔ flash.
  reactionMs: number | null
  start(): void
  onHeldChange(held: ReadonlySet<number>): void
}

export interface PracticeStoreDeps {
  pool?: readonly Combo[]
  rng?: Rng
  now?: () => number
}

export function createPracticeStore({
  pool = MAJOR_TRIADS_COMBOS,
  rng = Math.random,
  now = Date.now,
}: PracticeStoreDeps = {}) {
  const recentKeys: string[] = []
  let held: ReadonlySet<number> = new Set()
  let shownAt = 0

  return createStore<PracticeStoreState>()((set, get) => {
    const nextPrompt = () => {
      const combo = pickCombo(pool, recentKeys, rng)
      recentKeys.push(comboKey(combo))
      if (recentKeys.length > RECENT_WINDOW) recentKeys.shift()
      shownAt = now()
      set({
        prompt: createPrompt(combo),
        phase: held.size === 0 ? 'armed' : 'awaiting-release',
      })
    }

    return {
      prompt: null,
      phase: 'idle',
      reactionMs: null,

      start() {
        if (get().prompt !== null) return // React StrictMode mounts effects twice
        nextPrompt()
      },

      onHeldChange(next: ReadonlySet<number>) {
        held = next
        const { phase, prompt } = get()
        if (phase === 'awaiting-release' && next.size === 0) {
          set({ phase: 'armed' })
          return
        }
        if (phase !== 'armed' || prompt === null) return
        if (matches(next, prompt.chord, prompt.voicing)) {
          set({ phase: 'advancing', reactionMs: now() - shownAt })
          setTimeout(nextPrompt, AUTO_ADVANCE_MS)
        }
      },
    }
  })
}

export const practiceStore = createPracticeStore()

export function usePractice<T>(selector: (state: PracticeStoreState) => T): T {
  return useStore(practiceStore, selector)
}
