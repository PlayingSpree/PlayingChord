import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import {
  ActiveTimeTracker,
  applyOutcome,
  AttemptLifecycle,
  builtInPresets,
  canSetAside,
  chordOrderOf,
  chordPassList,
  chordsOpenedBefore,
  comboKey,
  comboLabel,
  comboMetrics,
  createPrompt,
  dailyChordCount,
  dailyPool,
  DEFAULT_DIATONIC_KEY,
  effectiveLength,
  expandPreset,
  fillQueue,
  filterUnlockedCombos,
  gradeRank,
  IMPROVED_MIN_ATTEMPTS,
  initialProgress,
  InMemoryComboStats,
  isChordInLearning,
  isLearnSetComplete,
  isPassingGrade,
  MODE_POLICY,
  defaultLearnSelection,
  learnFillerChords,
  learnPoolChordKeys,
  rehearsedChords,
  sanitizeLearnSelection,
  selectableLearnChords,
  sessionLengthReached,
  MAX_TIME_TO_CORRECT_MS,
  notPassedChordKeys,
  poolChordKey,
  rankWorstCombos,
  RECENT_WINDOW,
  reconcileProgress,
  recordChordAttempt,
  romanNumeral,
  worstChordGrade,
  worstChordDisplayGrade,
  openChord,
  setAsideChord,
  sanitizeSessionLength,
  DEFAULT_SESSION_LENGTH,
  SessionRun,
  songChordLabel,
  SongEngine,
  UPCOMING_COUNT,
  unlockedChordKeys,
  wrongHeldKeys,
  type AttemptPhase,
  type ChordPassEntry,
  type Combo,
  type ComboGrade,
  type ComboStatRecord,
  type DisplayGrade,
  type ReportChord,
  type LifecycleState,
  type ComboStatsSource,
  type Hint,
  type PracticeSettings,
  type Preset,
  type PresetProgressRecord,
  type Prompt,
  type PromptOutcome,
  type Rng,
  type SessionLength,
  type SessionMode,
  type SessionReport,
  type SessionRunContext,
  type SessionStats,
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
  PersistedBestStreak,
  PersistedComboStats,
  PersistedDailyActivity,
  PersistedPresetProgress,
  type BestStreakSource,
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
  passed: number
  total: number
  // Unlocked chords the player has set aside (§5.2). Part of the snapshot so
  // a set-aside — which moves neither of the counts above — still changes
  // this object, and Home's In play row re-derives from it.
  setAside: number
}

// One chord's status in the unlock chip's per-chord drill-down (§7), with a
// display label resolved through the active expansion (diatonic spelling).
export interface ChordPassDisplayEntry extends ChordPassEntry {
  label: string
}

// One chord of the learn loop's set (§5.4) as the Stage and sheet read it: its
// session grade — from the loop's own reps, never the lifetime record — and
// whether that grade has reached the pass bar.
export interface LearnChordProgress {
  key: string
  label: string
  grade: ComboGrade | null
  rehearsed: boolean
}

// The learn loop's live state (§5.4). `filler` is the learned chords dealt
// alongside the set to keep the pool at three; they are named so the sheet and
// Stage can say what is being dealt, and they are deliberately absent from
// `chords` — nothing about them ends the session.
export interface LearnProgress {
  chords: readonly LearnChordProgress[]
  filler: readonly string[]
  rehearsed: number
  total: number
}

export const EMPTY_LEARN_PROGRESS: LearnProgress = {
  chords: [],
  filler: [],
  rehearsed: 0,
  total: 0,
}

// A combo whose grade just improved mid-session (§7.3): the label it's known
// by in the chord stats, and the two letters, for the line under the ✔ pill.
export interface GradeUpFlash {
  label: string
  from: ComboGrade
  to: ComboGrade
}

// How long the top-bar chip celebrates a fresh unlock before settling.
export const JUST_UNLOCKED_FLASH_MS = 2_500

// Buffered active time is persisted once this much accrues — every held-note
// change would rewrite the whole state blob for single-digit ms gains.
export const ACTIVE_FLUSH_MS = 5_000

// Thin adapter over the pure practice engine: picks weighted prompts from
// the selected preset, feeds held-set changes into the §6.2 machine, mirrors
// machine state out for the UI, and records prompt outcomes into the
// persisted stats (§7: miss = any miss before the eventual
// correct). It also owns the §7.2 session layer: Learn/Practice/Song modes,
// the prompt-count length with its end-of-session Report (§7.4),
// worst-chords-only drilling, and active-minutes → daily goal/streak tracking.
export interface PracticeStoreState {
  presets: readonly Preset[]
  presetId: string
  diatonicKey: PitchClass
  prompt: Prompt | null
  // Did the rep the ✔ flash is showing lift a chord that was still being
  // learned (§5.1: unlocked, not yet passed) to a passing grade? Set on the
  // judgment edge and read by the §7.3 pill, which is on screen before the
  // outcome is actually recorded (that happens on advance) — so this is the
  // same pass call applyProgress will make, one advance window early.
  justLearned: boolean
  // The §7.3 ready gate: a Practice session (fresh or resumed) holds its first
  // prompt until the player says they're set — a tap on the Stage or any note.
  // Nothing is dealt while this is true, so time-to-correct can't absorb the
  // walk-up to the keyboard. Learn and Song don't gate (see start()).
  awaitingReady: boolean
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
  // Free-practice setting (§7): it lives beside the mode picker, not in
  // the settings panel, and resets with the app load.
  worstOnly: boolean
  // The learn loop's chord set (§5.4), same lifecycle as worstOnly: the
  // poolChordKeys the player picked in the sheet, in unlock order. Defaults to
  // the in-play chords not yet passed and is re-derived whenever the pool moves
  // under it. Learn deals these plus enough learned chords to make three.
  learnSelection: readonly string[]
  // Live state of that set (§5.4) — which of its chords have reached D on this
  // session's own reps, which is both the Stage's counter and what ends the
  // session. Empty outside Learn.
  learnProgress: LearnProgress
  // Did the rep the ✔ flash is showing just bring a selected chord up to the
  // pass bar (§5.4)? Learn's counterpart to justLearned, and equally a call
  // made one advance window early — see applyFlashes.
  justRehearsed: boolean
  // Session length (§7.2): prompts or active minutes, ∞ for unlimited.
  // Session-only (not persisted). Applies to Learn and free practice; Song
  // ignores it and daily practice runs to its persisted cap instead (§5.3).
  sessionLength: SessionLength
  // Prompts advanced past this session — correct + Learn — the Stage's
  // done/length readout and the report's zero-prompt guard.
  done: number
  // Active ms accrued in *this* session — what a timed length counts against
  // (§7.2) and the Stage's ⏱ readout. Mirrored out as the buffered active
  // time moves, so it advances only while actually playing.
  sessionActiveMs: number
  // The end-of-session Report (§7.4); null while a session is live or after
  // it's dismissed. Zero-prompt sessions end with no report (§7.2).
  report: SessionReport | null
  session: SessionStats
  // Consecutive first-try correct prompts; resets on any miss and whenever
  // the session itself resets. The UI calls this a *combo* (§7.3 "🔥 10 combo"), rhythm-game
  // sense — unrelated to a Combo, the (root, typeId, voicingId) triple stats
  // are keyed by.
  firstTryStreak: number
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
  // A combo that just climbed a grade (§7.3), shown under the ✔ pill for as
  // long as that flash lasts — like justLearned, it is news about the rep on
  // screen. Practice-only, and gated on enough attempts to mean something
  // (§5 chord score over the recent window).
  gradeUp: GradeUpFlash | null
  start(): void
  // Answer the §7.3 ready gate: deal the prompt start() withheld. A no-op
  // unless a gated session is actually waiting.
  ready(): void
  onHeldChange(held: ReadonlySet<number>): void
  setPreset(id: string): void
  setDiatonicKey(key: PitchClass): void
  setMode(mode: SessionMode): void
  setWorstOnly(on: boolean): void
  // Set the learn loop's chords (§5.4). Sanitized against what is actually in
  // play, so a stale key from the sheet's draft can never reach generation.
  setLearnSelection(chordKeys: readonly string[]): void
  // The chords the learn-loop picker may offer for a preset — unlocked, not set
  // aside, with their labels and current pass state. Takes the preset because
  // the session sheet asks about its *draft* (§7.2), like canDrillWorstOnly.
  learnChoices(
    presetId: string,
    diatonicKey: PitchClass,
  ): readonly ChordPassDisplayEntry[]
  // What the picker opens with for a preset (§5.4): the in-play chords not yet
  // passed, or the most recently reached ones when there is nothing waiting.
  defaultLearnChoice(
    presetId: string,
    diatonicKey: PitchClass,
  ): readonly string[]
  // The learned chords that would be dealt alongside a drafted selection to
  // keep the pool at three (§5.4) — labels, for the sheet's summary line.
  learnFillerLabels(
    presetId: string,
    diatonicKey: PitchClass,
    selection: readonly string[],
  ): readonly string[]
  setSessionLength(length: SessionLength): void
  // End the session now (§7.2 End button, or auto at the length): build the
  // Report and freeze practice. A zero-prompt session ends with report = null
  // (the caller returns Home).
  endSession(): void
  // Abandon an in-flight session with no Report (§7.2 Start / Go again), so
  // the next start() begins fresh instead of resuming.
  discardSession(): void
  dismissReport(): void
  // Leaving the Stage temporarily — the MIDI gate raised by an unplug (§6.1),
  // or the session sheet opened over it (§7.2). Judging halts and the prompt
  // drops, but the session stays live: start() resumes it on return.
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
  // Every pool chord in unlock order with its locked/unlocked/passed status
  // and display label — the unlock chip's per-chord drill-down (§7).
  chordPassStatus(): readonly ChordPassDisplayEntry[]
  // §5.2 by-hand pool control, from Home and the Report. Both no-op when the
  // move isn't available (the MIN_ACTIVE_CHORDS floor, an already-open chord),
  // so the caller can offer them without re-deriving the rules.
  setChordAside(chordKey: string): void
  openChordForPlay(chordKey: string): void
  // May this chord be set aside right now (§5.2)? False once doing so would
  // leave too little in play.
  canSetChordAside(chordKey: string): boolean
  // How many chords ahead of a locked one openChordForPlay would open with it
  // — the unlock frontier is a prefix (§5.1), so the control says so.
  chordsOpenedWith(chordKey: string): number
  // Would "worst chords only" (§5) have anything to drill in this preset —
  // i.e. does its narrowed pool come out non-empty? Takes the preset rather
  // than reading the active one because the session sheet asks about its
  // *draft* (§7.2), before any of it reaches the store. Computed on demand
  // from the persisted records, so it never goes stale between sessions.
  canDrillWorstOnly(presetId: string, diatonicKey: PitchClass): boolean
  // How many chords daily practice (§5.3) would draw from right now — the
  // learned chords of every preset, deduplicated. Zero means the mode has
  // nothing to drill and Home / the sheet offer it disabled. Computed on
  // demand from the persisted records, like canDrillWorstOnly.
  learnedChordCount(): number
}

export interface PracticeStoreDeps {
  presets?: (diatonicKey: PitchClass) => readonly Preset[]
  voicings?: () => VoicingLibrary
  stats?: ComboStatsSource
  activity?: DailyActivitySource
  progress?: PresetProgressSource
  bestStreak?: BestStreakSource
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
  bestStreak = new PersistedBestStreak(appStorage),
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
  // What this session has accumulated about itself (§7.2) — its recorded
  // prompts, the chords it passed / opened / rehearsed, its active time and the
  // grade climbs already announced. Replaced wholesale at each session start,
  // which is what makes a session start over.
  let run = new SessionRun()
  // Is a session running (§7.2)? True from start() until the session ends —
  // through a Report (endSession/the length) or a restart (discardSession) —
  // and it stays true across a pause(), which is what lets the Stage resume
  // instead of restarting. Nothing generates a prompt while this is false, so
  // Home's mode chips and the session sheet's pickers are pure config: no
  // judging, no stats, no Song clock outside the Stage (§7.1).
  let sessionLive = false
  // The learn loop's own stat source (§5.4): grading is session-local, so the
  // loop reads and writes this and never the persisted records — it can't move
  // a lifetime grade, the weighting or the unlock queue. Replaced wholesale at
  // each session start, which is what makes a chord's progress start over.
  let learnStats = new InMemoryComboStats()
  // Which selected chords have reached the pass bar on those reps, and their
  // labels in the order they got there — the Stage counter and the Report list.
  let learnRehearsed: ReadonlySet<string> = new Set()
  // Buffered active time, deliberately *not* session-scoped: a partial flush
  // survives into the next session, so it outlives the run beside it (§7.6).
  let pendingActiveMs = 0
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

    // A preset's chord order and its reconciled unlock record (§5.1), read
    // without touching the store's own. Split out of reloadProgress so
    // canDrillWorstOnly can ask about a preset the store hasn't switched to.
    const derivedProgress = (preset: Preset, combos: readonly Combo[]) => {
      // Circle-of-fifths unlock order (§5.1) applies only to root-ordered
      // (product) pools — diatonic/explicit orders are deliberate as-is.
      const order = chordOrderOf(
        combos,
        settings().unlockByFifths && preset.pool.kind === 'product'
          ? 'fifths'
          : 'pool',
      )
      const stored = progressStore.get(preset.id)
      const record = reconcileProgress(
        stored ?? initialProgress(order.length),
        order.length,
      )
      return { order, stored, record }
    }

    // The §5.3 daily pool: every preset's learned chords, folded together.
    // Cached because it expands *every* preset (built-ins plus custom) and is
    // asked for on each prompt; `dailyCombos = null` marks it stale, which
    // every path that can change a preset's pool or its progress does.
    let dailyCombos: Combo[] | null = null
    const invalidateDaily = () => {
      dailyCombos = null
    }

    const buildDailyPool = (): Combo[] =>
      dailyPool(
        presets(get().diatonicKey).map((preset) => {
          const combos = expandPreset(preset, voicings()).combos
          const { order, record } = derivedProgress(preset, combos)
          return { combos, chordOrder: order, record }
        }),
      )

    const currentDailyPool = (): Combo[] => {
      if (dailyCombos === null) dailyCombos = buildDailyPool()
      return dailyCombos
    }

    const reloadProgress = () => {
      const { order, stored, record } = derivedProgress(
        activePreset,
        expansion.combos,
      )
      chordOrder = order
      progressRecord = record
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
      passed: progressRecord.masteredIndices.length,
      total: chordOrder.length,
      setAside: progressRecord.setAsideIndices.length,
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

    // The grade-up notice has no timer of its own — it rides the ✔ flash
    // (§7.3, judgeGradeUp), so it only needs clearing when practice stops.
    const clearGradeFlash = () => {
      if (get().gradeUp !== null) set({ gradeUp: null })
    }

    // Compact "Am"-style label for a chord-order key, for the unlock toast:
    // resolved through the expansion so the diatonic pool's key spellings
    // apply, same as the Song chips.
    // Takes the expansion so the session sheet can label the preset it has
    // *drafted* (§7.2), which is not necessarily the active one.
    const draftChordLabel = (
      from: ReturnType<typeof expandPreset>,
      key: string,
    ): string => {
      const combo = from.combos.find((c) => poolChordKey(c) === key)
      if (combo === undefined) return key
      return songChordLabel(
        from.rootSpellings.get(combo.root) ?? spellRoot(combo.root),
        combo.typeId,
      )
    }

    const chordKeyLabel = (key: string): string =>
      draftChordLabel(expansion, key)

    // The §5.1 pass grade of a whole chord: the worst of its combos in the
    // current pool, from the persisted records — the same figure Home's In play
    // row shows (§7.1), so a chord can't read red there and pass here. Combos of
    // the chord with no history yet don't count against it (worstChordGrade
    // takes only the records that exist); with none at all it has no grade.
    // `projected` swaps in a record that hasn't been written yet, which is how
    // the pill calls the pass during the advance window (see judgeLearned).
    // `source` is the persisted records everywhere except the learn loop, which
    // grades its own session in isolation (§5.4) — same fold, same pass bar,
    // different evidence.
    const chordGradeFrom = (
      source: ComboStatsSource,
      chordKey: string,
      projected?: { key: string; record: ComboStatRecord },
    ): ComboGrade | null => {
      const records: ComboStatRecord[] = []
      for (const combo of expansion.combos) {
        if (poolChordKey(combo) !== chordKey) continue
        const key = comboKey(combo)
        const record =
          projected !== undefined && projected.key === key
            ? projected.record
            : source.get(key)
        if (record !== null) records.push(record)
      }
      return worstChordGrade(records)
    }

    const chordGrade = (
      chordKey: string,
      projected?: { key: string; record: ComboStatRecord },
    ): ComboGrade | null => chordGradeFrom(stats, chordKey, projected)

    // The same fold as chordGrade, but through the display rule (§7.5) — an
    // unproven combo reads `new`, not F. What the §5.2 suggestion judges on:
    // a chord that has barely been played needs reps, not a bench.
    const chordDisplayGrade = (chordKey: string): DisplayGrade | null => {
      const records: ComboStatRecord[] = []
      for (const combo of expansion.combos) {
        if (poolChordKey(combo) !== chordKey) continue
        const record = stats.get(comboKey(combo))
        if (record !== null) records.push(record)
      }
      return worstChordDisplayGrade(records)
    }

    // A selected chord's grade on this session's reps alone (§5.4). `projected`
    // swaps in the rep that hasn't been written yet, the same trick the ✔ pill
    // plays for the practice callouts.
    const learnChordGrade = (
      chordKey: string,
      projected?: { key: string; record: ComboStatRecord },
    ): ComboGrade | null => chordGradeFrom(learnStats, chordKey, projected)

    // Re-derive which selected chords are rehearsed and publish the loop's
    // state (§5.4). Called after each learn rep and wherever the selection or
    // the pool moves, so `learnProgress` is never read against a stale set.
    const publishLearnProgress = () => {
      const selection = get().learnSelection
      if (!MODE_POLICY[get().mode].hasLearnLoop) {
        if (get().learnProgress !== EMPTY_LEARN_PROGRESS) {
          set({ learnProgress: EMPTY_LEARN_PROGRESS })
        }
        return
      }
      learnRehearsed = rehearsedChords(selection, learnChordGrade)
      const chords = selection.map((key) => ({
        key,
        label: chordKeyLabel(key),
        grade: learnChordGrade(key),
        rehearsed: learnRehearsed.has(key),
      }))
      for (const chord of chords) {
        if (chord.rehearsed) run.noteRehearsed(chord.label)
      }
      set({
        learnProgress: {
          chords,
          filler: learnFillerChords(chordOrder, progressRecord, selection).map(
            chordKeyLabel,
          ),
          rehearsed: learnRehearsed.size,
          total: selection.length,
        },
      })
    }

    // Keep the selection valid against the pool it names (§5.4): a preset or key
    // change, a library edit, a set-aside, a progress reset. Anything no longer
    // in play drops out, and a selection emptied that way falls back to the
    // default rather than leaving the loop with nothing to finish.
    const syncLearnSelection = () => {
      const sanitized = sanitizeLearnSelection(
        chordOrder,
        progressRecord,
        get().learnSelection,
      )
      const selection =
        sanitized.length > 0
          ? sanitized
          : defaultLearnSelection(chordOrder, progressRecord)
      set({ learnSelection: selection })
      publishLearnProgress()
    }

    // The preset's benched chords in unlock order (§5.2), for the Report's
    // bring-back offer.
    const setAsideChords = (): { chordKey: string; label: string }[] =>
      chordPassList(chordOrder, progressRecord)
        .filter((entry) => entry.setAside)
        .map((entry) => ({
          chordKey: entry.key,
          label: chordKeyLabel(entry.key),
        }))

    // The chords this session actually played, folded from its per-combo
    // events, with what the §5.2 suggestion rule needs to judge them.
    const reportChords = (): ReportChord[] => {
      const chordOf = new Map<string, string>()
      for (const combo of expansion.combos) {
        chordOf.set(comboKey(combo), poolChordKey(combo))
      }
      const misses = new Map<string, number>()
      const played: string[] = []
      for (const event of run.events) {
        const chordKey = chordOf.get(event.key)
        if (chordKey === undefined) continue
        if (!played.includes(chordKey)) played.push(chordKey)
        if (event.outcome === 'missed') {
          misses.set(chordKey, (misses.get(chordKey) ?? 0) + 1)
        }
      }
      return played.map((chordKey) => ({
        chordKey,
        label: chordKeyLabel(chordKey),
        grade: chordDisplayGrade(chordKey),
        misses: misses.get(chordKey) ?? 0,
        canSetAside: canSetAside(chordOrder, progressRecord, chordKey),
      }))
    }

    // Writes a by-hand progress change (§5.2) through: persist, re-derive the
    // in-play set, drop the preview queue (the pool changed, like any other
    // pool change) and redeal a live prompt so a chord just set aside isn't
    // left on screen. These are Home/Report controls, so a live prompt is the
    // paused-with-settings-open case rather than the usual one.
    const applyManualProgress = (next: PresetProgressRecord) => {
      if (next === progressRecord) return
      progressRecord = next
      unlocked = unlockedChordKeys(chordOrder, progressRecord)
      progressStore.set(activePreset.id, progressRecord)
      queue = []
      recentKeys = []
      invalidateDaily() // a benched chord leaves the daily pool too (§5.3)
      set({ progress: progressSnapshot() })
      // A benched chord leaves the learn set with everything else (§5.4).
      syncLearnSelection()
      if (get().mode !== 'song' && get().prompt !== null) nextPrompt()
    }

    // Feeds a completed free-practice prompt into the §5 unlock progress — as
    // the chord's grade, so it must run *after* stats.record(). On an unlock,
    // the queue is dropped so newly opened chords can enter the very next
    // preview refill (the pool changed, same rule as every other pool change).
    //
    // Daily practice never gets here (see recordOutcome): its pool is the
    // learned chords of *every* preset (§5.3), so an index into the selected
    // preset's unlock order would be the wrong chord as often as the right
    // one — and everything it deals is passed already, so there is nothing
    // for it to pass.
    const applyProgress = (combo: Combo) => {
      const update = recordChordAttempt(
        chordOrder,
        progressRecord,
        poolChordKey(combo),
        chordGrade(poolChordKey(combo)),
      )
      if (!update.changed) return
      // The chord just passed this attempt (§5.1) — collect it for the Report.
      run.notePassed(chordKeyLabel(poolChordKey(combo)))
      const previousCount = progressRecord.unlockedCount
      progressRecord = update.record
      unlocked = unlockedChordKeys(chordOrder, progressRecord)
      progressStore.set(activePreset.id, progressRecord)
      invalidateDaily() // a chord just passed — it joins the daily pool (§5.3)
      set({ progress: progressSnapshot() })
      if (update.justUnlocked) {
        queue = []
        const newLabels = chordOrder
          .slice(previousCount, progressRecord.unlockedCount)
          .map(chordKeyLabel)
        run.noteUnlocked(newLabels)
        flashJustUnlocked(newLabels)
      }
    }

    // The §5/§7 "worst chords only" pool, drawn from the persisted records:
    // "worst" is chords with a miss on the record — plus the chords still
    // being learned (§5.1: unlocked, not yet passed). A chord you've never
    // passed belongs in a weak-spots drill even with a clean sheet: most
    // likely you've barely played it, and leaving it out means the toggle can
    // only revisit old mistakes and never the gaps. Worst first, so the
    // ranking still leads the weighted draw. Empty means the toggle has
    // nothing to narrow to — which is both what makes generation fall back to
    // the full pool and what disables the toggle in the sheet.
    const worstOnlyPool = (
      available: readonly Combo[],
      order: readonly string[],
      record: PresetProgressRecord,
    ): Combo[] => {
      const worst = rankWorstCombos(available, stats, available.length)
      const worstKeys = new Set(worst.map(({ combo }) => comboKey(combo)))
      const notPassed = notPassedChordKeys(order, record)
      const learning = available.filter(
        (combo) =>
          notPassed.has(poolChordKey(combo)) && !worstKeys.has(comboKey(combo)),
      )
      return [...worst.map(({ combo }) => combo), ...learning]
    }

    // Learn and free practice generate only from the selected preset's
    // unlocked chords (§5); Song bypasses this entirely (it draws from the
    // preset's raw pool) and daily practice replaces it with the cross-preset
    // learned pool (§5.3). "Worst chords only" (free, §5/§7) and the learn
    // loop's chord set (§5.4) then each narrow generation within the unlocked
    // set; an empty result (every unlocked chord already passed with nothing
    // ever missed, or a selection the pool no longer contains) falls back to
    // the whole unlocked pool.
    const pickPool = (): readonly Combo[] => {
      const state = get()
      const available = filterUnlockedCombos(expansion.combos, unlocked)
      if (state.mode === 'daily') {
        // Defensive: the mode is offered only when something is learned
        // (learnedChordCount), but nextPrompt needs a non-empty pool (§5).
        const pool = currentDailyPool()
        return pool.length > 0 ? pool : available
      }
      if (MODE_POLICY[state.mode].supportsWorstOnly && state.worstOnly) {
        const pool = worstOnlyPool(available, chordOrder, progressRecord)
        if (pool.length > 0) return pool
      }
      if (state.mode === 'learn') {
        const learnPool = learnPoolChordKeys(
          chordOrder,
          progressRecord,
          state.learnSelection,
        )
        const filtered = available.filter((combo) =>
          learnPool.has(poolChordKey(combo)),
        )
        if (filtered.length > 0) return filtered
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
        justLearned: false,
        upcoming: queue.map((c) => ({
          key: comboKey(c),
          label: comboLabel(c, expansion.rootSpellings.get(c.root), voicings()),
        })),
      })
      machine.promptShown(prompt)
    }

    // Deal the next prompt, or raise the §7.3 ready gate instead when a
    // practice session has nothing on screen yet: entering the Stage, and
    // every pool change that lands while the gate is still up (a preset
    // switch, a sheet toggle over a paused session). A prompt already showing
    // means the player is at the keyboard, so a pool change re-deals at once
    // as it always has — the gate is about the *first* prompt's clock.
    const dealOrGate = () => {
      if (MODE_POLICY[get().mode].gatesOnReady && get().prompt === null) {
        set({ awaitingReady: true })
        return
      }
      set({ awaitingReady: false })
      nextPrompt()
    }

    // Advance the session's played-prompt count (§7.2): every prompt that
    // advances counts a slot — correct or Learn.
    const bumpDone = () => set((state) => ({ done: state.done + 1 }))

    // What actually ends this session (§7.2), resolved per mode by the policy
    // — the same rule the Stage's progress readout reads.
    const currentLength = (): SessionLength =>
      effectiveLength(
        get().mode,
        get().sessionLength,
        settings().dailyCapMinutes,
      )

    // A learn rep, which lands in the loop's own stats and nowhere else (§5.4):
    // not the per-combo records, not the weighting, not the unlock queue, not
    // the session tallies or the report log. Filler chords are recorded too —
    // the grade is per chord and reading one costs nothing — but only the
    // selection is ever asked whether it's rehearsed.
    const recordLearnRep = () => {
      if (currentCombo === null) return
      learnStats.record(
        comboKey(currentCombo),
        machine.state.missCount > 0 ? 'missed' : 'first-try',
        Math.min(machine.state.reactionMs ?? 0, MAX_TIME_TO_CORRECT_MS),
      )
      currentCombo = null
      publishLearnProgress()
    }

    // A prompt only completes through the 'advancing' phase. Learn-mode prompts
    // complete without touching anything persisted (§5) — recordLearnRep takes
    // them instead. Returns whether a recorded prompt was logged (a ✔ that
    // counts a done slot on its own — the caller only bumps done for Learn).
    const recordOutcome = (): boolean => {
      if (currentCombo === null || machine.state.phase !== 'advancing') {
        return false
      }
      if (MODE_POLICY[get().mode].statsSource === 'session') {
        recordLearnRep()
        return false
      }
      const outcome: PromptOutcome =
        machine.state.missCount > 0 ? 'missed' : 'first-try'
      // One clamp point for the whole recording path (§6.2): combo stats and
      // weighting, unlock progress, the session tallies, the Report log and —
      // through stats.record — the day's summed time. A rep that reaches the
      // ceiling is demoted for grading only, inside applyOutcome.
      const timeToCorrectMs = Math.min(
        machine.state.reactionMs ?? 0,
        MAX_TIME_TO_CORRECT_MS,
      )
      const key = comboKey(currentCombo)
      const label = comboLabel(
        currentCombo,
        expansion.rootSpellings.get(currentCombo.root),
        voicings(),
      )
      stats.record(key, outcome, timeToCorrectMs)
      // Only free practice moves the unlock queue (§5.1): daily draws from
      // every preset at once and has nothing left to pass (§5.3).
      if (MODE_POLICY[get().mode].movesUnlockProgress) {
        applyProgress(currentCombo)
      }
      run.logEvent({ key, label, outcome, timeToCorrectMs })
      // Defensive: a ✔ is recorded exactly once — clear the combo so a stray
      // second recordOutcome (still 'advancing') can't double-count it.
      currentCombo = null
      // The combo streak isn't touched here — it moves on the judgment edges
      // themselves (applyStreak below), which is what keeps the flash honest.
      set((state) => ({ session: run.stats(), done: state.done + 1 }))
      return true
    }

    // The §7.3 combo streak, driven by the judgment edges rather than by the
    // completed prompt: a miss drops it the moment the ✘ lands (it used to
    // wait for the auto-advance, which left the ✔ flash of a missed prompt
    // claiming a streak the miss had already ended — and made a *surviving*
    // streak undercount by one, so "🔥 10 combo" appeared on the 11th), and a
    // first-try ✔ counts itself. Learn is stats-neutral (§5) and Song bars
    // have no self-paced streak.
    const applyStreak = (next: LifecycleState) => {
      const state = get()
      if (!MODE_POLICY[state.mode].streaks) return
      if (next.missCount > state.missCount) {
        if (state.firstTryStreak > 0) set({ firstTryStreak: 0 })
        return
      }
      if (
        next.phase === 'advancing' &&
        state.phase !== 'advancing' &&
        next.missCount === 0
      ) {
        const firstTryStreak = state.firstTryStreak + 1
        set({ firstTryStreak })
        bestStreak.record(firstTryStreak)
      }
    }

    // Everything the ✔ flash says about the rep it belongs to has to be worked
    // out on the judgment edge: outcomes are recorded on *advance*, by which
    // time the flash is already gone. This projects the record recordOutcome
    // will write — same inputs, one window early — so the pill and the stats
    // can't disagree. Practice only: Learn records nothing (§5) and Song bars
    // never reach the machine — daily and free alike record, so both project.
    interface ProjectedRep {
      key: string
      combo: Combo
      before: ComboStatRecord | null
      record: ComboStatRecord
    }

    const projectRep = (next: LifecycleState): ProjectedRep | null => {
      const mode = get().mode
      if (currentCombo === null) return null
      // Learn projects too (§5.4) — against its own stats, for its own callout.
      const statsSource = MODE_POLICY[mode].statsSource
      if (statsSource === null) return null
      const source = statsSource === 'session' ? learnStats : stats
      const key = comboKey(currentCombo)
      const before = source.get(key)
      return {
        key,
        combo: currentCombo,
        before,
        record: applyOutcome(
          before,
          next.missCount > 0 ? 'missed' : 'first-try',
          Math.min(next.reactionMs ?? 0, MAX_TIME_TO_CORRECT_MS),
        ),
      }
    }

    // The §7.3 `learned` callout: the same chord grade applyProgress will read,
    // over the same records, with this rep projected in. Daily practice passes
    // nothing (recordOutcome), so it never claims to — the same chord can sit
    // unlocked-but-unpassed in the *selected* preset while being learned in
    // another, and the pill would otherwise announce a pass that never lands.
    const judgeLearned = ({ key, combo, record }: ProjectedRep): boolean => {
      if (!MODE_POLICY[get().mode].announcesLearned) return false
      const chordKey = poolChordKey(combo)
      if (!isChordInLearning(chordOrder, progressRecord, chordKey)) return false
      return isPassingGrade(chordGrade(chordKey, { key, record }))
    }

    // The §7.3 grade-up chip. Both grades must rest on at least the
    // most-improved evidence floor — below that a letter swings on one rep and
    // the notice is noise — and each letter is news once per session per combo
    // (announcedGradeUps): a grade rides a moving window, so a combo hovering
    // on a cut point re-crosses it every few reps, and B → A → B → A would
    // otherwise announce the same A over and over.
    const judgeGradeUp = ({
      key,
      combo,
      before,
      record,
    }: ProjectedRep): GradeUpFlash | null => {
      // Practice only: Learn's letters are session-local (§5.4), and a chip
      // announcing a climb that no record will hold would be a lie.
      if (!MODE_POLICY[get().mode].announcesGradeUp) return null
      if (before === null || before.attempts < IMPROVED_MIN_ATTEMPTS)
        return null
      const from = comboMetrics(before).grade
      const to = comboMetrics(record).grade
      if (gradeRank(to) <= gradeRank(from)) return null
      if (!run.announceGradeUp(key, to)) return null
      const label = comboLabel(
        combo,
        expansion.rootSpellings.get(combo.root),
        voicings(),
      )
      return { label, from, to }
    }

    // Both callouts ride the ✔ flash itself (§7.3), so they are decided on the
    // edge into 'advancing' and last exactly as long as it does — the pill
    // renders neither in any other phase.
    // The §5.4 `✓ rehearsed` callout: this rep took a *selected* chord that
    // wasn't there yet to the pass bar, judged on the loop's own stats with the
    // rep projected in — the same call publishLearnProgress will make once it
    // lands. Filler chords never earn it; nothing about them is the point.
    const judgeRehearsed = ({ key, combo, record }: ProjectedRep): boolean => {
      if (!MODE_POLICY[get().mode].announcesRehearsed) return false
      const chordKey = poolChordKey(combo)
      if (!get().learnSelection.includes(chordKey)) return false
      if (learnRehearsed.has(chordKey)) return false
      return isPassingGrade(learnChordGrade(chordKey, { key, record }))
    }

    const applyFlashes = (next: LifecycleState) => {
      if (next.phase !== 'advancing' || get().phase === 'advancing') return
      const rep = projectRep(next)
      const justLearned = rep !== null && judgeLearned(rep)
      if (justLearned !== get().justLearned) set({ justLearned })
      const justRehearsed = rep !== null && judgeRehearsed(rep)
      if (justRehearsed !== get().justRehearsed) set({ justRehearsed })
      const gradeUp = rep === null ? null : judgeGradeUp(rep)
      if (gradeUp !== null || get().gradeUp !== null) set({ gradeUp })
    }

    const machine = new AttemptLifecycle({
      settings,
      now,
      // Learn mode shows the answer from the start (§7), so misses never
      // escalate to the redundant miss-3 reveal (§6.4).
      revealOnMisses: () => !MODE_POLICY[get().mode].revealsAnswer,
      onState: (state) => {
        // Both read the pre-transition state, so they run before the set()
        applyStreak(state)
        applyFlashes(state)
        set(state)
      },
      onAdvance: () => {
        // A Learn prompt records nothing persisted but still consumes a slot.
        if (!recordOutcome()) bumpDone()
        // The learn loop ends on its set, not on a length (§5.4) — checked
        // here, between prompts, for the same reason the length is.
        if (
          MODE_POLICY[get().mode].hasLearnLoop &&
          isLearnSetComplete(get().learnSelection, learnRehearsed)
        ) {
          concludeSession()
          return
        }
        // Checked between prompts, so a timed session never cuts a rep off
        // mid-attempt (§7.2) — and its clock is active time, so it can only
        // run out while someone is playing.
        if (sessionLengthReached(currentLength(), get().done, run.activeMs)) {
          concludeSession() // reached the §7.2 length → Report
          return
        }
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
      // A bar also counts as a played prompt in the session (§7.4): it logs a
      // (timeless) session event and ticks the tallies, so a Song session
      // produces a Report like any other. Song ignores the length (§7.2), so
      // there's no end check here — it runs until the End button.
      onBarResult: (chord, hit) => {
        const key = songComboKey(chord)
        const outcome: PromptOutcome = hit ? 'first-try' : 'missed'
        stats.record(key, outcome, null)
        run.logEvent({
          key,
          label: songLabel(chord),
          outcome,
          timeToCorrectMs: null,
        })
        set((state) => ({ session: run.stats(), done: state.done + 1 }))
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
      const delta = activeTime.touch(now())
      if (delta === 0) return
      pendingActiveMs += delta
      // This session's share: the report's time increment, and the clock a
      // timed session (§7.2) and daily practice's cap (§5.3) run against.
      run.addActiveMs(delta)
      set({ sessionActiveMs: run.activeMs })
      if (pendingActiveMs >= ACTIVE_FLUSH_MS) flushActivity()
    }

    const resetSession = () => {
      run = new SessionRun()
      // A fresh loop grades from nothing (§5.4): last session's reps are gone,
      // so a chord rehearsed yesterday must be brought up again today. That is
      // the point of grading the session rather than the record.
      learnStats = new InMemoryComboStats()
      learnRehearsed = new Set()
      set({
        session: run.stats(),
        firstTryStreak: 0,
        done: 0,
        sessionActiveMs: 0,
        awaitingReady: false,
        justRehearsed: false,
      })
      publishLearnProgress()
    }

    // Everything the §7.4 Report needs that the session itself doesn't hold:
    // the persisted history it is measured against, and the figures derived
    // from the pool it was drawn from. The run merges its own tallies in.
    const reportContext = (): SessionRunContext => {
      const records = activity.records()
      let lifetimePrompts = 0
      let lifetimeActiveMinutes = 0
      for (const record of Object.values(records)) {
        lifetimePrompts += record.prompts
        lifetimeActiveMinutes += record.activeMinutes
      }
      return {
        mode: get().mode,
        promptsPlayed: get().done,
        records,
        todayKey: localDateKey(new Date(now())),
        lifetime: {
          prompts: lifetimePrompts,
          activeMinutes: lifetimeActiveMinutes,
        },
        goal: currentGoal(),
        chords: reportChords(),
        setAside: setAsideChords(),
        unlockedTotals: {
          unlocked: progressRecord.unlockedCount,
          passed: progressRecord.masteredIndices.length,
          total: chordOrder.length,
        },
        learnRemaining: get()
          .learnProgress.chords.filter((chord) => !chord.rehearsed)
          .map((chord) => chord.label),
      }
    }

    // Halt practice without deciding what comes next: the Song clock and the
    // attempt machine stop, buffered active time lands, the prompt clears and
    // the session is no longer live. Shared by the two ways a session ends —
    // with a Report (concludeSession) or without one (discardSession).
    const haltSession = () => {
      if (get().mode === 'song') leaveSong()
      machine.stop()
      flushActivity()
      sessionLive = false
      clearGradeFlash() // the ✔ it rode is gone with the prompt
      set({
        prompt: null,
        justLearned: false,
        justRehearsed: false,
        awaitingReady: false,
      })
    }

    // End the current session (§7.2): freeze practice and show the Report — or
    // return with no report when zero prompts played. The caller/endSession has
    // already recorded any pending ✔.
    const concludeSession = () => {
      haltSession()
      set({ report: get().done > 0 ? run.report(reportContext()) : null })
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
      // The diatonic preset's pool follows its key, so the learned set can
      // move under a selection change as well as a progress one (§5.3).
      invalidateDaily()
      clearUnlockFlash()
      clearGradeFlash()
      memory.save({ presetId: preset.id, diatonicKey })
      set({
        presets: list,
        presetId: preset.id,
        diatonicKey,
        progress: progressSnapshot(),
        justUnlocked: false,
        justUnlockedLabels: [],
      })
      // The selection names chords in the *old* pool (§5.4) — re-derive it
      // before anything generates from the new one.
      syncLearnSelection()
      // Outside a session this is pure config (Home's Change control, the
      // sheet's preset picker) — the pool is picked up by the next start().
      if (!sessionLive) return
      // A live song rebuilds from the new pool with a fresh count-in; a
      // paused one (no clock) picks the pool up on the next start().
      if (get().mode === 'song') {
        songEngine.setPool(preset.pool)
        return
      }
      dealOrGate()
    }

    return {
      presets: initialPresets,
      presetId: initialId,
      diatonicKey: initialKey,
      prompt: null,
      justLearned: false,
      awaitingReady: false,
      phase: 'idle',
      reactionMs: null,
      missCount: 0,
      hint: null,
      mode: 'free',
      song: null,
      songChords: [],
      songSummary: null,
      worstOnly: false,
      learnSelection: defaultLearnSelection(chordOrder, progressRecord),
      learnProgress: EMPTY_LEARN_PROGRESS,
      justRehearsed: false,
      sessionLength: DEFAULT_SESSION_LENGTH,
      done: 0,
      sessionActiveMs: 0,
      report: null,
      session: run.stats(),
      firstTryStreak: 0,
      upcoming: [],
      goal: currentGoal(),
      progress: progressSnapshot(),
      justUnlocked: false,
      justUnlockedLabels: [],
      gradeUp: null,

      start() {
        // Entering the Stage (§7.2): begins a fresh session, or resumes the
        // live one when the Stage was only left temporarily — the MIDI gate
        // raised by an unplug (§6.1) or the session sheet opened over it. A
        // resumed session keeps its count and tallies and is dealt a fresh
        // prompt (Song counts a fresh progression in, as pause() documents).
        // Idempotent under StrictMode's double-mount and never runs over an
        // open Report.
        if (get().report !== null) return
        if (sessionLive) {
          if (get().prompt !== null) return
        } else {
          resetSession()
          sessionLive = true
        }
        if (get().mode === 'song') {
          songEngine.start(activePreset.pool)
          return
        }
        // Practice waits for the player before the clock starts (§7.3). Learn
        // is stats-neutral (§5) and Song counts itself in (§6.5), so neither
        // gains anything from a gate — they deal straight away.
        dealOrGate()
      },

      ready() {
        if (!sessionLive || !get().awaitingReady) return
        set({ awaitingReady: false })
        nextPrompt() // stamps shownAt (§6.2) — the gate's whole purpose
      },

      onHeldChange(held: ReadonlySet<number>) {
        touchActivity()
        // Any note answers the ready gate (§7.3). The machine still sees the
        // held set first — it judges nothing while idle, but knowing what's
        // down means the prompt the gate deals arms only once that key is
        // released (§6.2 step 1), like every other prompt.
        if (get().awaitingReady) {
          machine.heldChange(held)
          if (held.size > 0) get().ready()
          return
        }
        if (get().mode === 'song') {
          songHeld = held
          songEngine.heldChange(held)
          set({ hint: songWrongHint(get().song) })
          return
        }
        machine.heldChange(held)
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
        queue = [] // the pool can change (worstOnly/the learn set are per-mode)
        // Leaving the mode ends the run (§7.3). Only Practice can break a
        // streak — Learn records no outcome at all and Song is clock-paced —
        // so without this a detour parks the count and hands it back intact,
        // which is a free pass on a counter nothing else forgives.
        if (get().firstTryStreak > 0) set({ firstTryStreak: 0 })
        if (!sessionLive) {
          set({ mode })
          publishLearnProgress()
          return
        }
        if (mode === 'song') {
          machine.stop() // clears phase/hint/reactionMs via onState
          set({ mode, upcoming: [] })
          publishLearnProgress()
          songEngine.start(activePreset.pool)
          return
        }
        set({ mode })
        // Switching into Learn mid-session starts its loop from the reps it has
        // taken so far — none, unless the session began in Learn (§5.4).
        publishLearnProgress()
        if (leavingSong) leaveSong()
        dealOrGate()
      },

      setWorstOnly(on: boolean) {
        if (on === get().worstOnly) return
        // Free practice only — not rendered elsewhere, but stay safe.
        if (!MODE_POLICY[get().mode].supportsWorstOnly) return
        recordOutcome()
        queue = []
        set({ worstOnly: on })
        if (sessionLive) dealOrGate()
      },

      setLearnSelection(chordKeys: readonly string[]) {
        const selection = sanitizeLearnSelection(
          chordOrder,
          progressRecord,
          chordKeys,
        )
        const current = get().learnSelection
        if (
          selection.length === current.length &&
          selection.every((key, i) => key === current[i])
        ) {
          return
        }
        recordOutcome()
        queue = []
        set({ learnSelection: selection })
        publishLearnProgress()
        if (sessionLive && MODE_POLICY[get().mode].hasLearnLoop) dealOrGate()
      },

      learnChoices(presetId: string, diatonicKey: PitchClass) {
        const { preset, expansion: draft } = resolve(presetId, diatonicKey)
        const { order, record } = derivedProgress(preset, draft.combos)
        return selectableLearnChords(order, record).map((entry) => ({
          ...entry,
          label: draftChordLabel(draft, entry.key),
        }))
      },

      defaultLearnChoice(presetId: string, diatonicKey: PitchClass) {
        const { preset, expansion: draft } = resolve(presetId, diatonicKey)
        const { order, record } = derivedProgress(preset, draft.combos)
        return defaultLearnSelection(order, record)
      },

      learnFillerLabels(
        presetId: string,
        diatonicKey: PitchClass,
        selection: readonly string[],
      ) {
        const { preset, expansion: draft } = resolve(presetId, diatonicKey)
        const { order, record } = derivedProgress(preset, draft.combos)
        return learnFillerChords(order, record, selection).map((key) =>
          draftChordLabel(draft, key),
        )
      },

      setSessionLength(length: SessionLength) {
        set({ sessionLength: sanitizeSessionLength(length) })
      },

      endSession() {
        // The End button (§7.2), any mode, any time. A pending ✔ counts toward
        // the ending session; then build the Report (or none if nothing played).
        if (get().report !== null) return
        recordOutcome()
        concludeSession()
      },

      discardSession() {
        // Start / Go again (§7.2): whatever was in flight is abandoned with no
        // Report, so the next start() begins fresh rather than resuming.
        if (!sessionLive) return
        recordOutcome() // a pending ✔ still counts against the lifetime stats
        haltSession()
      },

      dismissReport() {
        set({ report: null })
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
        invalidateDaily() // a custom preset's learned chords can move with it
        if (preset.id !== current.presetId) {
          // The active preset vanished (deleted, or now empty) — the
          // resolver fell back; remember the fallback like any selection.
          recentKeys = []
          memory.save({ presetId: preset.id, diatonicKey: current.diatonicKey })
        }
        set({
          presets: list,
          presetId: preset.id,
          progress: progressSnapshot(),
        })
        syncLearnSelection() // an edit can take a selected chord out of the pool
        // Paused (settings/Progress open) or outside a session means no
        // prompt to refresh; a live prompt/song is redealt so it can't
        // reference deleted content.
        if (!sessionLive) return
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
        invalidateDaily() // any preset's wipe empties its share of §5.3
        if (presetId !== activePreset.id) return
        reloadProgress()
        clearUnlockFlash()
        clearGradeFlash()
        queue = []
        recentKeys = []
        set({
          progress: progressSnapshot(),
          justUnlocked: false,
          justUnlockedLabels: [],
        })
        // The wipe re-locks chords the learn set may have named (§5.4).
        syncLearnSelection()
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
        // Passed *indices* carry onto the new order (§5.1), so which chords
        // count as learned moves with it — the daily pool with them.
        invalidateDaily()
        clearUnlockFlash()
        clearGradeFlash()
        queue = []
        recentKeys = []
        set({
          progress: progressSnapshot(),
          justUnlocked: false,
          justUnlockedLabels: [],
        })
        // Which chords are in play moves with the order (§5.1), so the learn
        // set can name one that just fell behind the frontier.
        syncLearnSelection()
        // Usually toggled from Settings while paused (no prompt); a live
        // Learn/Practice prompt redeals from the reordered unlocked set.
        if (get().mode !== 'song' && get().prompt !== null) nextPrompt()
      },

      chordPassStatus() {
        return chordPassList(chordOrder, progressRecord).map((entry) => ({
          ...entry,
          label: chordKeyLabel(entry.key),
        }))
      },

      setChordAside(chordKey: string) {
        // A pending ✔ counts (and may pass its chord) under the outgoing
        // pool, like every other pool change.
        recordOutcome()
        applyManualProgress(setAsideChord(chordOrder, progressRecord, chordKey))
      },

      openChordForPlay(chordKey: string) {
        recordOutcome()
        applyManualProgress(openChord(chordOrder, progressRecord, chordKey))
      },

      canSetChordAside(chordKey: string) {
        return canSetAside(chordOrder, progressRecord, chordKey)
      },

      chordsOpenedWith(chordKey: string) {
        return chordsOpenedBefore(chordOrder, progressRecord, chordKey)
      },

      canDrillWorstOnly(presetId: string, diatonicKey: PitchClass) {
        const { preset, expansion: draft } = resolve(presetId, diatonicKey)
        const { order, record } = derivedProgress(preset, draft.combos)
        const available = filterUnlockedCombos(
          draft.combos,
          unlockedChordKeys(order, record),
        )
        return worstOnlyPool(available, order, record).length > 0
      },

      learnedChordCount() {
        return dailyChordCount(currentDailyPool())
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
