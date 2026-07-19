import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import {
  ActiveTimeTracker,
  AttemptLifecycle,
  builtInPresets,
  chordOrderOf,
  comboKey,
  comboLabel,
  createPrompt,
  DEFAULT_DIATONIC_KEY,
  expandPreset,
  fillQueue,
  filterUnlockedCombos,
  initialProgress,
  poolChordKey,
  rankWorstCombos,
  RECENT_WINDOW,
  reconcileProgress,
  recordChordAttempt,
  romanNumeral,
  sanitizeTimerMinutes,
  songChordLabel,
  SongEngine,
  UPCOMING_COUNT,
  unlockedChordKeys,
  summarizeSession,
  wrongHeldKeys,
  type AttemptPhase,
  type Combo,
  type ComboStatsSource,
  type Hint,
  type PracticeSettings,
  type Preset,
  type PresetProgressRecord,
  type Prompt,
  type PromptOutcome,
  type Rng,
  type SessionEvent,
  type SessionMode,
  type SessionSummary,
  type SongChord,
  type SongState,
} from '../practice'
import {
  BUILT_IN_VOICING_LIBRARY,
  spellRoot,
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
  PersistedPresetProgress,
  type DailyActivitySource,
  type PresetProgressSource,
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

// A §5/§7 upcoming-preview entry: the next combos to be dealt, in order.
export interface UpcomingChord {
  key: string
  label: string
}

// One chip of the §6.5 Song-mode progression display: compact chord label
// ("Am") over its Roman numeral ("vi" — empty unless the pool is diatonic),
// keyed like the per-combo stats.
export interface SongChordChip {
  key: string
  label: string
  roman: string
}

// A §6.5 phrase-summary entry, mirrored ready for display: the summary
// outlives the progression it tallies, so its labels are resolved here.
export interface SongSummaryEntry {
  label: string
  hits: number
  loops: number
}

// Today's progress toward the §7 daily goal, mirrored into reactive state
// whenever buffered active time flushes (appStorage itself isn't reactive).
export interface GoalProgress {
  todayMinutes: number
  streak: number
}

// The active preset's §5 unlock progress, mirrored for the top-bar chip.
export interface UnlockProgress {
  unlocked: number
  total: number
}

// How long the top-bar chip celebrates a fresh unlock before settling.
export const JUST_UNLOCKED_FLASH_MS = 2_500

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
  mode: SessionMode
  // Song mode (§6.5): the engine's live snapshot (null outside Song), the
  // progression display chips derived per progression, and the previous
  // phrase's summary (non-null only during a post-phrase count-in).
  song: SongState | null
  songChords: readonly SongChordChip[]
  songSummary: readonly SongSummaryEntry[] | null
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
  // Next combos to be dealt, in order (§5/§7 preview); rebuilt whenever the
  // pool changes.
  upcoming: readonly UpcomingChord[]
  goal: GoalProgress
  // The active preset's §5 unlock state, plus a transient celebration flag
  // set for JUST_UNLOCKED_FLASH_MS when a batch unlocks — with the newly
  // opened chords' labels for the unlock toast.
  progress: UnlockProgress
  justUnlocked: boolean
  justUnlockedLabels: readonly string[]
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
  // Wipe a preset's §5 unlock progress back to the initial unlock count.
  resetPresetProgress(presetId: string): void
  // Re-derive the active preset's unlock order after the §5.1 order setting
  // changes; the unlocked count carries over onto the new order.
  refreshUnlockOrder(): void
}

export interface PracticeStoreDeps {
  presets?: (diatonicKey: PitchClass) => readonly Preset[]
  voicings?: () => VoicingLibrary
  stats?: ComboStatsSource
  activity?: DailyActivitySource
  progress?: PresetProgressSource
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
  progress: progressStore = new PersistedPresetProgress(appStorage),
  memory = persistedPresetMemory,
  rng = Math.random,
  now = Date.now,
  settings = () => settingsStore.getState().settings,
}: PracticeStoreDeps = {}) {
  let recentKeys: string[] = []
  // Next combos to be dealt, in order (§5 upcoming preview); invalidated
  // (reset to []) wherever the pool/expansion can change, alongside
  // recentKeys.
  let queue: Combo[] = []
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

    // The resolved active preset and its expansion, kept in lockstep by
    // applySelection/refreshLibrary — Song draws its pool from the preset,
    // everything else generates from the expansion.
    let { preset: activePreset, expansion } = resolve(initialId, initialKey)

    // The §5 unlock state for the active preset, kept in lockstep with the
    // expansion by reloadProgress(): the pool's chord order, the persisted
    // record (reconciled against the real pool size — a custom pool can
    // shrink under its saved progress), and the unlocked chord-key set the
    // generator filters by.
    let chordOrder: string[] = []
    let progressRecord: PresetProgressRecord = initialProgress(1)
    let unlocked: ReadonlySet<string> = new Set()
    let justUnlockedTimer: ReturnType<typeof setTimeout> | null = null

    const reloadProgress = () => {
      // Circle-of-fifths unlock order (§5.1) applies only to root-ordered
      // (product) pools — diatonic/explicit orders are deliberate as-is.
      chordOrder = chordOrderOf(
        expansion.combos,
        settings().unlockByFifths && activePreset.pool.kind === 'product'
          ? 'fifths'
          : 'pool',
      )
      const stored = progressStore.get(activePreset.id)
      progressRecord = reconcileProgress(
        stored ?? initialProgress(chordOrder.length),
        chordOrder.length,
      )
      // Persist a reconciliation that changed a stored record, so the
      // self-heal happens once instead of on every load.
      if (
        stored !== null &&
        JSON.stringify(stored) !== JSON.stringify(progressRecord)
      ) {
        progressStore.set(activePreset.id, progressRecord)
      }
      unlocked = unlockedChordKeys(chordOrder, progressRecord)
    }
    reloadProgress()

    const progressSnapshot = (): UnlockProgress => ({
      unlocked: progressRecord.unlockedCount,
      total: chordOrder.length,
    })

    const clearUnlockFlash = () => {
      if (justUnlockedTimer !== null) {
        clearTimeout(justUnlockedTimer)
        justUnlockedTimer = null
      }
    }

    const flashJustUnlocked = (labels: readonly string[]) => {
      clearUnlockFlash()
      set({ justUnlocked: true, justUnlockedLabels: labels })
      justUnlockedTimer = setTimeout(() => {
        justUnlockedTimer = null
        set({ justUnlocked: false, justUnlockedLabels: [] })
      }, JUST_UNLOCKED_FLASH_MS)
    }

    // Compact "Am"-style label for a chord-order key, for the unlock toast:
    // resolved through the expansion so the diatonic pool's key spellings
    // apply, same as the Song chips.
    const chordKeyLabel = (key: string): string => {
      const combo = expansion.combos.find((c) => poolChordKey(c) === key)
      if (combo === undefined) return key
      return songChordLabel(
        expansion.rootSpellings.get(combo.root) ?? spellRoot(combo.root),
        combo.typeId,
      )
    }

    // Feeds a completed Practice prompt into the §5 unlock progress. On an
    // unlock, the queue is dropped so newly opened chords can enter the very
    // next preview refill (the pool changed, same rule as every other pool
    // change).
    const applyProgress = (
      combo: Combo,
      outcome: PromptOutcome,
      timeToCorrectMs: number,
    ) => {
      const update = recordChordAttempt(
        chordOrder,
        progressRecord,
        poolChordKey(combo),
        outcome,
        timeToCorrectMs,
      )
      if (!update.changed) return
      const previousCount = progressRecord.unlockedCount
      progressRecord = update.record
      unlocked = unlockedChordKeys(chordOrder, progressRecord)
      progressStore.set(activePreset.id, progressRecord)
      set({ progress: progressSnapshot() })
      if (update.justUnlocked) {
        queue = []
        flashJustUnlocked(
          chordOrder
            .slice(previousCount, progressRecord.unlockedCount)
            .map(chordKeyLabel),
        )
      }
    }

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

    // Learn/Practice generate only from unlocked chords (§5); Song bypasses
    // this entirely (it draws from the preset's raw pool). "Worst chords
    // only" (§5/§7) then narrows generation within the unlocked set; an
    // empty ranking (nothing missed yet — possible right after a preset
    // switch) falls back to the whole unlocked pool.
    const pickPool = (): readonly Combo[] => {
      const state = get()
      const available = filterUnlockedCombos(expansion.combos, unlocked)
      if (state.mode === 'practice' && state.worstOnly) {
        const worst = rankWorstCombos(available, stats, available.length)
        if (worst.length > 0) return worst.map((w) => w.combo)
      }
      return available
    }

    const nextPrompt = () => {
      const pool = pickPool()
      if (queue.length === 0) {
        queue = fillQueue([], 1, pool, recentKeys, stats, rng)
      }
      const combo = queue.shift()
      // Unreachable: fillQueue(_, 1, ...) always returns exactly one combo
      // for a non-empty pool, and pickPool() never returns an empty pool.
      if (combo === undefined) throw new Error('Upcoming queue was empty')
      currentCombo = combo
      recentKeys.push(comboKey(combo))
      if (recentKeys.length > RECENT_WINDOW) recentKeys.shift()
      queue = fillQueue(queue, UPCOMING_COUNT, pool, recentKeys, stats, rng)
      const prompt = createPrompt(
        combo,
        expansion.rootSpellings.get(combo.root),
        voicings(),
      )
      set({
        prompt,
        worstChords: worstChords(),
        upcoming: queue.map((c) => ({
          key: comboKey(c),
          label: comboLabel(c, expansion.rootSpellings.get(c.root), voicings()),
        })),
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
      applyProgress(currentCombo, outcome, timeToCorrectMs)
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
      // Learn mode shows the answer from the start (§7), so misses never
      // escalate to the redundant miss-3 reveal (§6.4).
      revealOnMisses: () => get().mode !== 'learn',
      onState: (state) => set(state),
      onAdvance: () => {
        recordOutcome()
        nextPrompt()
      },
    })

    // Song mode (§6.5): the clock-paced engine beside the self-paced
    // machine — only one is live per mode. Its progressions draw from the
    // active preset's pool, same as the other modes; prompts are derived per
    // progression (identity-compared: the engine replaces the array
    // wholesale) so the keyboard/staff reuse the ordinary Prompt plumbing.
    let songProgression: readonly SongChord[] = []
    let songPrompts: Prompt[] = []
    let songHeld: ReadonlySet<number> = new Set()

    const songComboKey = (chord: SongChord): string =>
      comboKey({ root: chord.root, typeId: chord.typeId, voicingId: 'any' })

    // Chip/summary label: spelled from the expansion like every other
    // label — the diatonic pool's key spellings included.
    const songLabel = (chord: SongChord): string =>
      songChordLabel(
        expansion.rootSpellings.get(chord.root) ?? spellRoot(chord.root),
        chord.typeId,
      )

    // Song's §6.4-style wrong-key marking, without the hint machinery: a
    // foreign held key is marked while held, never escalating. Recomputed on
    // every held change AND every engine emit — the mark must follow the
    // chord when the bar turns over under sustained keys.
    const songWrongHint = (state: SongState | null): Hint | null => {
      if (state === null || state.countingIn) return null
      const chord = songPrompts[state.barIndex]?.chord
      if (chord === undefined) return null
      const notes = wrongHeldKeys(songHeld, chord)
      return notes.length > 0 ? { kind: 'wrong-keys', notes } : null
    }

    const songEngine = new SongEngine({
      settings,
      now,
      rng,
      onState: (state) => {
        if (state.progression !== songProgression) {
          songProgression = state.progression
          songPrompts = state.progression.map((chord) =>
            createPrompt(
              { root: chord.root, typeId: chord.typeId, voicingId: 'any' },
              expansion.rootSpellings.get(chord.root),
              voicings(),
            ),
          )
          set({
            songChords: state.progression.map((chord) => ({
              key: songComboKey(chord),
              label: songLabel(chord),
              roman: chord.degree === null ? '' : romanNumeral(chord.degree),
            })),
          })
        }
        set({
          song: state,
          prompt: songPrompts[state.barIndex] ?? null,
          hint: songWrongHint(state),
          songSummary:
            state.phraseSummary?.map((entry) => ({
              label: songLabel(entry.chord),
              hits: entry.hits,
              loops: entry.loops,
            })) ?? null,
        })
      },
      // Each judged bar feeds the per-combo record — hit = first-try, miss =
      // attempt — with no time sample (§6.5); Practice weighting inherits it.
      onBarResult: (chord, hit) => {
        stats.record(songComboKey(chord), hit ? 'first-try' : 'missed', null)
      },
    })

    // Leaving Song: halt the clock (the in-flight bar is abandoned silently)
    // and drop the derived state.
    const leaveSong = () => {
      songEngine.stop()
      songProgression = []
      songPrompts = []
      set({ song: null, songChords: [], songSummary: null, hint: null })
    }

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
      activePreset = preset
      expansion = next
      recentKeys = []
      queue = []
      reloadProgress()
      clearUnlockFlash()
      memory.save({ presetId: preset.id, diatonicKey })
      set({
        presets: list,
        presetId: preset.id,
        diatonicKey,
        progress: progressSnapshot(),
        justUnlocked: false,
        justUnlockedLabels: [],
      })
      // A live song rebuilds from the new pool with a fresh count-in; a
      // paused one (no clock) picks the pool up on the next start().
      if (get().mode === 'song') {
        songEngine.setPool(preset.pool)
        return
      }
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
      mode: 'practice',
      song: null,
      songChords: [],
      songSummary: null,
      worstOnly: false,
      timerMinutes: null,
      timerEndsAt: null,
      summary: null,
      session: FRESH_SESSION,
      worstChords: [],
      upcoming: [],
      goal: currentGoal(),
      progress: progressSnapshot(),
      justUnlocked: false,
      justUnlockedLabels: [],

      start() {
        // React StrictMode mounts effects twice; a paused store re-prompts,
        // but never over an open summary.
        if (get().prompt !== null || get().summary !== null) return
        if (get().mode === 'song') {
          songEngine.start(activePreset.pool)
          return
        }
        nextPrompt()
      },

      onHeldChange(held: ReadonlySet<number>) {
        touchActivity()
        if (get().mode === 'song') {
          songHeld = held
          songEngine.heldChange(held)
          set({ hint: songWrongHint(get().song) })
          return
        }
        machine.heldChange(held)
      },

      skip() {
        if (get().mode === 'song') return // clock-paced: no skipping (§6.5)
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
        const leavingSong = get().mode === 'song'
        // A pending ✔ counts under the outgoing mode's rules (recordOutcome
        // still sees the old mode); the current prompt is replaced so a
        // Learn reveal can't be answered for Practice credit.
        recordOutcome()
        clearTimer() // Learn/Song are untimed (§7); leaving ends a timer
        queue = [] // the pool can change (worstOnly only applies in practice)
        if (mode === 'song') {
          machine.stop() // clears phase/hint/reactionMs via onState
          set({ mode, upcoming: [] })
          songEngine.start(activePreset.pool)
          return
        }
        set({ mode })
        if (leavingSong) leaveSong()
        nextPrompt()
      },

      setWorstOnly(on: boolean) {
        if (on === get().worstOnly) return
        if (get().mode === 'song') return // not rendered in Song; stay safe
        recordOutcome()
        queue = []
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
        // A summary can be dismissed after switching into Song (the timer
        // expired earlier) — the song is already running, nothing to deal.
        if (get().mode === 'song') return
        nextPrompt()
      },

      pause() {
        if (get().prompt === null) return
        if (get().mode === 'song') {
          // Halt the clock; the in-flight bar is abandoned silently and a
          // fresh progression counts in on return (start()).
          leaveSong()
          flushActivity()
          set({ prompt: null })
          return
        }
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
        activePreset = preset
        expansion = next
        // The queue's combos are only guaranteed valid against the
        // expansion they were drawn from; a library edit can change rules
        // or spellings even when the preset itself is unchanged.
        queue = []
        // An edit can also grow/shrink the pool under its saved unlock
        // progress — re-derive and reconcile (§5).
        reloadProgress()
        if (preset.id !== current.presetId) {
          // The active preset vanished (deleted, or now empty) — the
          // resolver fell back; remember the fallback like any selection.
          recentKeys = []
          memory.save({ presetId: preset.id, diatonicKey: current.diatonicKey })
        }
        set({
          presets: list,
          presetId: preset.id,
          worstChords: worstChords(),
          progress: progressSnapshot(),
        })
        // Paused (settings/History open) means no prompt to refresh; a live
        // prompt/song is redealt so it can't reference deleted content.
        if (get().mode === 'song') {
          songEngine.setPool(preset.pool) // no-ops while paused
        } else if (get().prompt !== null) {
          recordOutcome()
          nextPrompt()
        }
      },

      resetPresetProgress(presetId: string) {
        // A pending ✔ on the active preset counts (and may master a chord)
        // before the wipe, like every other pool change.
        if (presetId === activePreset.id) recordOutcome()
        progressStore.reset(presetId)
        if (presetId !== activePreset.id) return
        reloadProgress()
        clearUnlockFlash()
        queue = []
        recentKeys = []
        set({
          progress: progressSnapshot(),
          justUnlocked: false,
          justUnlockedLabels: [],
        })
        // Song isn't gated (§6.5) and a paused store has no prompt to
        // re-deal; a live Learn/Practice prompt redeals from the narrowed
        // pool so a now-locked chord isn't left on screen.
        if (get().mode !== 'song' && get().prompt !== null) nextPrompt()
      },

      refreshUnlockOrder() {
        // A pending ✔ counts (and may master) under the outgoing order,
        // like every other pool change.
        recordOutcome()
        reloadProgress()
        clearUnlockFlash()
        queue = []
        recentKeys = []
        set({
          progress: progressSnapshot(),
          justUnlocked: false,
          justUnlockedLabels: [],
        })
        // Usually toggled from Settings while paused (no prompt); a live
        // Learn/Practice prompt redeals from the reordered unlocked set.
        if (get().mode !== 'song' && get().prompt !== null) nextPrompt()
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
