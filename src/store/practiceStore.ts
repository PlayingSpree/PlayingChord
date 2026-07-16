import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import {
  ActiveTimeTracker,
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
  sanitizeTimerMinutes,
  summarizeSession,
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
  type SessionEvent,
  type SessionMode,
  type SessionSummary,
} from '../practice'
import {
  BUILT_IN_VOICING_LIBRARY,
  voicingLibrary,
  type PitchClass,
  type VoicingLibrary,
} from '../theory'
import {
  appStorage,
  computeStreak,
  localDateKey,
  PersistedComboStats,
  PersistedDailyActivity,
  type DailyActivitySource,
} from '../storage'
import { settingsStore } from './settingsStore'
import { libraryStore } from './libraryStore'

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

// Live session tallies for the §7 stats bar. A "session" is one app load —
// until a session timer starts or its summary is dismissed, both of which
// begin a fresh one. Skips and Learn-mode prompts never count (§7);
// time-to-correct includes retries.
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

// Today's progress toward the §7 daily goal, mirrored into reactive state
// whenever buffered active time flushes (appStorage itself isn't reactive).
export interface GoalProgress {
  todayMinutes: number
  streak: number
}

// Buffered active time is persisted once this much accrues — every held-note
// change would rewrite the whole state blob for single-digit ms gains.
export const ACTIVE_FLUSH_MS = 5_000

// Thin adapter over the pure practice engine: picks weighted prompts from
// the selected preset, feeds held-set changes into the §6.2 machine, mirrors
// machine state out for the UI, and records prompt outcomes into the
// persisted stats (§7: skips excluded; miss = any miss before the eventual
// correct). Phase 7 adds the §7 session layer: Learn/Practice modes, the
// session timer with its end-of-session summary, worst-chords-only drilling,
// and active-minutes → daily goal/streak tracking.
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
  mode: SessionMode
  // Practice-mode settings (§7): they live beside the mode picker, not in
  // the settings panel, and reset with the app load.
  worstOnly: boolean
  timerMinutes: number | null // running timer's duration; null = off
  timerEndsAt: number | null // epoch ms, for the countdown display
  summary: SessionSummary | null
  session: SessionStats
  // Worst combos of the current preset from the *persisted* records, so the
  // list survives reloads (Milestone B) unlike the session tallies.
  worstChords: readonly WorstChordEntry[]
  goal: GoalProgress
  start(): void
  onHeldChange(held: ReadonlySet<number>): void
  skip(): void
  setPreset(id: string): void
  setDiatonicKey(key: PitchClass): void
  setMode(mode: SessionMode): void
  setWorstOnly(on: boolean): void
  startTimer(minutes: number): void
  cancelTimer(): void
  dismissSummary(): void
  // Leaving the practice view (History tab): halt judging and drop the
  // prompt so start() deals a fresh one on return.
  pause(): void
  // Re-derive goal/streak state (e.g. after the goal setting changes).
  refreshGoal(): void
  // Re-resolve presets/rules after the custom library changes (Phase 9):
  // a deleted active preset falls back, an edited one re-expands.
  refreshLibrary(): void
}

export interface PracticeStoreDeps {
  presets?: (diatonicKey: PitchClass) => readonly Preset[]
  voicings?: () => VoicingLibrary
  stats?: ComboStatsSource
  activity?: DailyActivitySource
  memory?: PresetMemory
  rng?: Rng
  now?: () => number
  settings?: () => PracticeSettings
}

export function createPracticeStore({
  presets = builtInPresets,
  voicings = () => BUILT_IN_VOICING_LIBRARY,
  stats = new PersistedComboStats(appStorage),
  activity = new PersistedDailyActivity(appStorage),
  memory = persistedPresetMemory,
  rng = Math.random,
  now = Date.now,
  settings = () => settingsStore.getState().settings,
}: PracticeStoreDeps = {}) {
  let recentKeys: string[] = []
  let currentCombo: Combo | null = null
  let sessionEvents: SessionEvent[] = []
  let pendingActiveMs = 0
  let timerHandle: ReturnType<typeof setTimeout> | null = null
  const activeTime = new ActiveTimeTracker()

  const remembered = memory.load()
  const initialKey = sanitizeDiatonicKey(remembered?.diatonicKey)
  const initialPresets = presets(initialKey)
  const fallback = initialPresets[0]
  if (!fallback) throw new Error('No presets defined')
  const initialId = initialPresets.some((p) => p.id === remembered?.presetId)
    ? (remembered?.presetId ?? fallback.id)
    : fallback.id

  const currentGoal = (): GoalProgress => ({
    todayMinutes: activity.todayMinutes(),
    streak: computeStreak(
      activity.records(),
      settings().dailyGoalMinutes,
      localDateKey(new Date(now())),
    ),
  })

  return createStore<PracticeStoreState>()((set, get) => {
    const resolve = (presetId: string, diatonicKey: PitchClass) => {
      const list = presets(diatonicKey)
      const first = list[0]
      if (!first) throw new Error('No presets defined')
      let preset = list.find((p) => p.id === presetId) ?? first
      let expansion = expandPreset(preset, voicings())
      // A custom preset can expand to nothing (its rules were edited under
      // it, or persisted junk); fall back to the first preset — built-ins
      // always have satisfiable combos.
      if (expansion.combos.length === 0 && preset !== first) {
        preset = first
        expansion = expandPreset(preset, voicings())
      }
      return { list, preset, expansion }
    }

    let expansion: ExpandedPreset = resolve(initialId, initialKey).expansion

    // The §7 worst-chords list for the current pool, from persisted records.
    const worstChords = (): WorstChordEntry[] =>
      rankWorstCombos(expansion.combos, stats).map(({ combo, record }) => ({
        key: comboKey(combo),
        label: comboLabel(
          combo,
          expansion.rootSpellings.get(combo.root),
          voicings(),
        ),
        accuracy: record.firstTrySuccesses / record.attempts,
      }))

    // "Worst chords only" (§5/§7) narrows generation to the preset's
    // qualifying combos; an empty ranking (nothing missed yet — possible
    // right after a preset switch) falls back to the whole pool.
    const pickPool = (): readonly Combo[] => {
      const state = get()
      if (state.mode === 'practice' && state.worstOnly) {
        const worst = rankWorstCombos(
          expansion.combos,
          stats,
          expansion.combos.length,
        )
        if (worst.length > 0) return worst.map((w) => w.combo)
      }
      return expansion.combos
    }

    const nextPrompt = () => {
      const combo = pickWeightedCombo(pickPool(), recentKeys, stats, rng)
      currentCombo = combo
      recentKeys.push(comboKey(combo))
      if (recentKeys.length > RECENT_WINDOW) recentKeys.shift()
      const prompt = createPrompt(
        combo,
        expansion.rootSpellings.get(combo.root),
        voicings(),
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
    // Learn-mode prompts complete but feed nothing either (§5): not the
    // per-combo records, not the session tallies or summary log.
    const recordOutcome = () => {
      if (currentCombo === null || machine.state.phase !== 'advancing') return
      if (get().mode === 'learn') return
      const outcome: PromptOutcome =
        machine.state.missCount > 0 ? 'missed' : 'first-try'
      const timeToCorrectMs = machine.state.reactionMs ?? 0
      const key = comboKey(currentCombo)
      stats.record(key, outcome, timeToCorrectMs)
      sessionEvents.push({
        key,
        label: comboLabel(
          currentCombo,
          expansion.rootSpellings.get(currentCombo.root),
          voicings(),
        ),
        outcome,
        timeToCorrectMs,
      })
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

    // Active minutes (§7): every held-note change is an interaction event
    // for the ActiveTimeTracker rule — including Learn mode and free play,
    // which count toward the goal even though they record no stats (§5).
    const publishGoal = () => set({ goal: currentGoal() })

    const flushActivity = () => {
      if (pendingActiveMs > 0) {
        activity.addMinutes(pendingActiveMs / 60_000)
        pendingActiveMs = 0
      }
      publishGoal()
    }

    const touchActivity = () => {
      pendingActiveMs += activeTime.touch(now())
      if (pendingActiveMs >= ACTIVE_FLUSH_MS) flushActivity()
    }

    const resetSession = () => {
      sessionEvents = []
      set({ session: FRESH_SESSION })
    }

    const clearTimer = () => {
      if (timerHandle !== null) {
        clearTimeout(timerHandle)
        timerHandle = null
      }
      set({ timerMinutes: null, timerEndsAt: null })
    }

    // The session timer ran out (§7): freeze practice and present the
    // summary. A ✔ still waiting out its advance window counts first.
    const timerExpired = () => {
      timerHandle = null
      recordOutcome()
      machine.stop()
      flushActivity()
      set({
        prompt: null,
        timerMinutes: null,
        timerEndsAt: null,
        summary: summarizeSession(sessionEvents),
      })
    }

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
      mode: 'practice',
      worstOnly: false,
      timerMinutes: null,
      timerEndsAt: null,
      summary: null,
      session: FRESH_SESSION,
      worstChords: [],
      goal: currentGoal(),

      start() {
        // React StrictMode mounts effects twice; a paused store re-prompts,
        // but never over an open summary.
        if (get().prompt !== null || get().summary !== null) return
        nextPrompt()
      },

      onHeldChange(held: ReadonlySet<number>) {
        touchActivity()
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

      setMode(mode: SessionMode) {
        if (mode === get().mode) return
        // A pending ✔ counts under the outgoing mode's rules (recordOutcome
        // still sees the old mode); the current prompt is replaced so a
        // Learn reveal can't be answered for Practice credit.
        recordOutcome()
        clearTimer() // Learn is untimed (§7); leaving ends a timer silently
        set({ mode })
        nextPrompt()
      },

      setWorstOnly(on: boolean) {
        if (on === get().worstOnly) return
        recordOutcome()
        set({ worstOnly: on })
        nextPrompt()
      },

      startTimer(minutes: number) {
        const sanitized = sanitizeTimerMinutes(minutes)
        if (
          sanitized === null ||
          get().mode !== 'practice' ||
          get().summary !== null
        ) {
          return
        }
        recordOutcome() // a pending ✔ belongs to the ending session
        if (timerHandle !== null) clearTimeout(timerHandle)
        resetSession() // the timed window is a fresh session (§7 summary)
        const durationMs = sanitized * 60_000
        timerHandle = setTimeout(timerExpired, durationMs)
        set({ timerMinutes: sanitized, timerEndsAt: now() + durationMs })
        nextPrompt()
      },

      cancelTimer() {
        clearTimer() // back to endless; the session continues, no summary
      },

      dismissSummary() {
        if (get().summary === null) return
        resetSession() // endless practice resumes as a fresh session
        set({ summary: null })
        nextPrompt()
      },

      pause() {
        if (get().prompt === null) return
        recordOutcome() // a ✔ waiting out its advance window still counts
        machine.stop()
        flushActivity()
        set({ prompt: null })
      },

      refreshGoal() {
        publishGoal()
      },

      refreshLibrary() {
        const current = get()
        const {
          list,
          preset,
          expansion: next,
        } = resolve(current.presetId, current.diatonicKey)
        expansion = next
        if (preset.id !== current.presetId) {
          // The active preset vanished (deleted, or now empty) — the
          // resolver fell back; remember the fallback like any selection.
          recentKeys = []
          memory.save({ presetId: preset.id, diatonicKey: current.diatonicKey })
        }
        set({ presets: list, presetId: preset.id, worstChords: worstChords() })
        // Paused (settings/History open) means no prompt to refresh; a live
        // one is redealt so it can't reference deleted content.
        if (get().prompt !== null) {
          recordOutcome()
          nextPrompt()
        }
      },
    }
  })
}

// The app singleton folds the Phase 9 custom library into generation; the
// factory defaults stay built-ins-only so tests are isolated from the
// shared appStorage singleton.
export const practiceStore = createPracticeStore({
  presets: (diatonicKey) => [
    ...builtInPresets(diatonicKey),
    ...libraryStore.getState().customPresets,
  ],
  voicings: () => voicingLibrary(libraryStore.getState().customRules),
})

// Library edits (create/edit/delete/import) re-resolve immediately.
libraryStore.subscribe(() => practiceStore.getState().refreshLibrary())

export function usePractice<T>(selector: (state: PracticeStoreState) => T): T {
  return useStore(practiceStore, selector)
}
