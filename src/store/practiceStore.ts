import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import {
  ActiveTimeTracker,
  applyOutcome,
  AttemptLifecycle,
  BATCH_WEIGHT_BOOST,
  builtInPresets,
  calibratePath,
  canSetAside,
  canSetAsideCombo,
  chapterById,
  chapterRows,
  CHAPTERS,
  chapterSong,
  chordOrderOf,
  chordPassList,
  chordsOpenedBefore,
  comboKey,
  comboView,
  comboLabel,
  comboMetrics,
  createPrompt,
  DEFAULT_DIATONIC_KEY,
  expandPreset,
  fillQueue,
  filterUnlockedCombos,
  gradeRank,
  IMPROVED_MIN_ATTEMPTS,
  initialProgress,
  isChordInLearning,
  isPassingGrade,
  areCombosPassed,
  isComboPassed,
  isPathCombo,
  isPathComplete,
  learningPool,
  MAX_TIME_TO_CORRECT_MS,
  modeRecordsReps,
  notPassedChordKeys,
  openCombo,
  passedCombos,
  passedTriadCount,
  PATH_COMBO_INDEX,
  PATH_RECENT_WINDOW,
  PATH_TRIAD_TOTAL,
  pathPosition,
  poolChordKey,
  rankWorstCombos,
  RECENT_WINDOW,
  reconcileProgress,
  reconcilePathProgress,
  recordChordAttempt,
  recordComboPass,
  repertoireCombos,
  repertoirePreset,
  REPERTOIRE_PRESET_ID,
  romanNumeral,
  setAsideCombo,
  songOffer,
  stampChapterSong,
  todayCard,
  worstChordGrade,
  worstChordDisplayGrade,
  openChord,
  setAsideChord,
  sanitizeSessionLength,
  DEFAULT_SESSION_LENGTH,
  songChordLabel,
  SongEngine,
  UPCOMING_COUNT,
  unlockedChordKeys,
  buildSessionReport,
  wrongHeldKeys,
  type AttemptPhase,
  type ChapterRow,
  type ChordPassEntry,
  type ChordPool,
  type Combo,
  type ComboGrade,
  type ComboStatRecord,
  type DisplayGrade,
  type ReportChord,
  type LifecycleState,
  type ComboStatsSource,
  type Hint,
  type PathComboView,
  type PathProgressRecord,
  type PracticeSettings,
  type Preset,
  type PresetProgressRecord,
  type Prompt,
  type PromptOutcome,
  type Rng,
  type SessionEvent,
  type SessionMode,
  type SessionReport,
  type SongChord,
  type SongState,
  type TodayCard,
} from '../practice'
import {
  BUILT_IN_VOICING_LIBRARY,
  spellMajorScaleDegree,
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
  PersistedPathProgress,
  PersistedPresetProgress,
  type BestStreakSource,
  type DailyActivitySource,
  type PathProgressSource,
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

// Live session tallies (§7). A "session" runs from start() to endSession()
// (§7.2); each fresh session zeroes these. Learn-mode prompts never count
// toward accuracy (§7); time-to-correct includes retries. Song bars
// count as prompts with no time sample (§6.5).
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

// A §5/§7 upcoming-preview entry: the next combos to be dealt, in order.
export interface UpcomingChord {
  key: string
  label: string
  // Backfill in the learning loop (§3.1): already-passed material mixed in
  // beside the batch. Labelled so a passed chord reappearing never reads as a
  // mistake. Always false in the other modes.
  review: boolean
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

// A combo whose grade just improved mid-session (§7.3): the label it's known
// by in the chord stats, and the two letters, for the line under the ✔ pill.
export interface GradeUpFlash {
  label: string
  from: ComboGrade
  to: ComboGrade
}

// Everything the guided path's screens read, derived from the record in one
// place (§4.1/§4.2). One object rather than a dozen fields because they always
// change together — a pass moves the position, the counter, the batch chips and
// the repertoire at once, and a component that got three of the four from
// separate selectors could render a half-updated path.
export interface PathSnapshot {
  today: TodayCard
  // 1-based for display; equal to chapterTotal + 1 when the path is complete.
  chapterNumber: number
  chapterTotal: number
  chapterTitle: string | null
  // 1-based batch position inside the current chapter.
  batchNumber: number
  batchTotal: number
  // The current batch with live grades — the Stage's chip row and the Today
  // card's progress display are the same data (§4.4).
  batch: readonly PathComboView[]
  // Distinct major/minor triads passed, out of 24 (§2.1). Deliberately not the
  // repertoire's size: C in two inversions is two combos and one chord.
  triadsPassed: number
  triadsTotal: number
  // Every passed combo with its grade, set-aside ones included and flagged —
  // the repertoire row (§4.1).
  repertoire: readonly PathComboView[]
  // The chapter whose song Home should offer, or null when nothing is owed.
  songChapterId: string | null
  songChapterTitle: string | null
  complete: boolean
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
  // Practice-mode settings (§7): they live beside the mode picker, not in
  // the settings panel, and reset with the app load.
  worstOnly: boolean
  // Session length in prompts (§7.2): reaching it ends the session. null = ∞;
  // session-only (not persisted). Applies to Learn/Practice; Song ignores it.
  sessionLength: number | null
  // Prompts advanced past this session — correct + Learn — the Stage's
  // done/length readout and the report's zero-prompt guard.
  done: number
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
  // screen. Recorded modes only, and gated on enough attempts to mean
  // something (§5 chord score over the recent window).
  gradeUp: GradeUpFlash | null
  // Is the prompt on screen a *first look* (§3.1)? The learning loop shows each
  // batch combo's shape on its opening rep and records nothing for it, so the
  // Learn/Practice distinction is per prompt rather than per session. Always
  // false outside the learning loop, and never true for backfill material.
  introRep: boolean
  // The guided path (§3, §4), recomputed whenever the record changes.
  path: PathSnapshot
  // The chapter whose song this Song session is playing (§3.3), or null for an
  // ordinary free-practice Song session.
  songChapterId: string | null
  // Set when the chapter song's phrase completed and stamped it — read by the
  // Report, cleared with the rest of the session state.
  songJustStamped: boolean
  start(): void
  // Answer the §7.3 ready gate: deal the prompt start() withheld. A no-op
  // unless a gated session is actually waiting.
  ready(): void
  onHeldChange(held: ReadonlySet<number>): void
  setPreset(id: string): void
  setDiatonicKey(key: PitchClass): void
  setMode(mode: SessionMode): void
  setWorstOnly(on: boolean): void
  setSessionLength(length: number | null): void
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

  // ─── The guided path (§3, §4) ───────────────────────────────────────────
  // Start the learning loop on the current batch (§3.1). Returns false when
  // there is no batch left to learn, so a stale Today card can't open an empty
  // session; the caller routes elsewhere.
  startPathLearn(): boolean
  // Start daily practice (§3.2): the v9 Practice session at ∞ on the derived
  // Repertoire preset. Returns false when nothing is passed yet.
  startRepertoire(): boolean
  // Start a key chapter's song checkpoint (§3.3): Song mode pinned to the
  // chapter's key with its I–IV–V–I progression. Returns false for an unknown
  // or songless chapter.
  startChapterSong(chapterId: string): boolean
  // Every chapter in order with its state and the current batch's grades — the
  // path map (§4.2). A method, not state: the map is a screen, not something
  // every Home render needs to recompute.
  chapterRows(): readonly ChapterRow[]
  // §5.2 by-hand pool control, now per combo and scoped to the repertoire
  // (§4.1). Both no-op when the move isn't available.
  setPathComboAside(comboKey: string): void
  openPathCombo(comboKey: string): void
  canSetPathComboAside(comboKey: string): boolean
  // "Reset path" (§6): back to chapter 1, uncalibrated, so the next load
  // re-derives the frontier from the surviving stat history (§5.2).
  resetPath(): void
}

export interface PracticeStoreDeps {
  presets?: (diatonicKey: PitchClass) => readonly Preset[]
  voicings?: () => VoicingLibrary
  stats?: ComboStatsSource
  activity?: DailyActivitySource
  progress?: PresetProgressSource
  path?: PathProgressSource
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
  path: pathStore = new PersistedPathProgress(appStorage),
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
  let sessionEvents: SessionEvent[] = []
  // Is a session running (§7.2)? True from start() until the session ends —
  // through a Report (endSession/the length) or a restart (discardSession) —
  // and it stays true across a pause(), which is what lets the Stage resume
  // instead of restarting. Nothing generates a prompt while this is false, so
  // Home's mode chips and the session sheet's pickers are pure config: no
  // judging, no stats, no Song clock outside the Stage (§7.1).
  let sessionLive = false
  // Chords passed / newly unlocked this session (§5.1) and the session's own
  // accrued active ms — the Report's passed/unlock lists and time increment
  // (§7.4). Reset alongside sessionEvents at each session start.
  let sessionPassedLabels: string[] = []
  let sessionUnlockedLabels: string[] = []
  let sessionActiveMs = 0
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
    // ─── The guided path (§3, §5.1) ─────────────────────────────────────────
    // First, because the preset list is a projection of it: calibration runs
    // once, here, before anything reads a position — so Home's very first paint
    // already shows the calibrated frontier (§5.2). A v9 upgrade and a fresh
    // install are the same code path: the migration leaves `calibrated: false`,
    // and this fast-passes whatever the stats already prove (nothing, fresh).
    let pathRecord = reconcilePathProgress(pathStore.get())
    if (!pathRecord.calibrated) {
      pathRecord = calibratePath(pathRecord, stats)
      pathStore.set(pathRecord)
    } else if (JSON.stringify(pathRecord) !== JSON.stringify(pathStore.get())) {
      // Persist a reconciliation that changed a stored record, so the self-heal
      // happens once rather than on every load — same as reloadProgress.
      pathStore.set(pathRecord)
    }

    // The preset list free practice picks from, with the derived Repertoire
    // preset (§3.2) at the front — a projection of path progress, so it is
    // built here rather than injected, and omitted entirely while nothing is
    // passed so the picker has no dead entry.
    const presetList = (diatonicKey: PitchClass): readonly Preset[] => {
      const authored = presets(diatonicKey)
      const repertoire = repertoirePreset(pathRecord)
      const combos =
        repertoire.pool.kind === 'combos' ? repertoire.pool.combos : []
      return combos.length > 0 ? [repertoire, ...authored] : authored
    }

    const resolve = (presetId: string, diatonicKey: PitchClass) => {
      const list = presetList(diatonicKey)
      // The fallback is the first *authored* preset, not the first in the list:
      // Repertoire sits at the front but is a projection of path progress, so it
      // is somewhere to go on purpose rather than somewhere to land by default —
      // and only a built-in is guaranteed to have satisfiable combos.
      const first = presets(diatonicKey)[0]
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
    const initial = resolve(initialId, initialKey)
    let activePreset = initial.preset
    let expansion = initial.expansion

    // The §5 unlock state for the active preset, kept in lockstep with the
    // expansion by reloadProgress(): the pool's chord order, the persisted
    // record (reconciled against the real pool size — a custom pool can
    // shrink under its saved progress), and the unlocked chord-key set the
    // generator filters by.
    let chordOrder: string[] = []
    let progressRecord: PresetProgressRecord = initialProgress(1)
    let unlocked: ReadonlySet<string> = new Set()
    let justUnlockedTimer: ReturnType<typeof setTimeout> | null = null

    // The learning loop's pool and the batch it belongs to, captured once when
    // the session starts (§3.1) and never re-derived while it runs. That
    // pinning is the whole session: the moment the batch passes, the *position*
    // moves to the next batch, so a pool that followed the position would roll
    // straight on through the chapter and never end. The weights still shift
    // rep by rep — they come from the stats, not from here.
    let learning = learningPool(pathRecord)

    const pathSnapshot = (): PathSnapshot => {
      const position = pathPosition(pathRecord)
      const passed = new Set(
        position.chapter === null
          ? []
          : (pathRecord.chapters[position.chapter.id]?.passed ?? []),
      )
      let batchStart = 0
      if (position.chapter !== null) {
        for (let b = 0; b < position.batchIndex; b++) {
          batchStart += position.chapter.batches[b]?.length ?? 0
        }
      }
      const song = songOffer(pathRecord)
      return {
        // Read from `activity` rather than from state.goal: this snapshot is
        // built once during construction, before any state exists, and it is
        // the same source currentGoal() publishes from anyway.
        today: todayCard(pathRecord, {
          goalMet: activity.todayMinutes() >= settings().dailyGoalMinutes,
        }),
        chapterNumber: position.chapterIndex + 1,
        chapterTotal: CHAPTERS.length,
        chapterTitle: position.chapter?.title ?? null,
        batchNumber: position.batchIndex + 1,
        batchTotal: position.batchTotal,
        batch: position.batch.map((pathCombo, i) =>
          comboView(pathRecord, pathCombo, passed.has(batchStart + i), stats),
        ),
        triadsPassed: passedTriadCount(pathRecord),
        triadsTotal: PATH_TRIAD_TOTAL,
        repertoire: repertoireViews(),
        songChapterId: song?.id ?? null,
        songChapterTitle: song?.title ?? null,
        complete: isPathComplete(pathRecord),
      }
    }

    // Passed combos with their live grades, set-aside ones included and
    // flagged: the repertoire row shows a benched combo dimmed *with* its
    // grade, because the debt is carried in the open (§5.2).
    const repertoireViews = (): readonly PathComboView[] =>
      passedCombos(pathRecord).map((pathCombo) =>
        comboView(pathRecord, pathCombo, true, stats),
      )

    // The path snapshot *and* the preset list, which is a projection of the
    // same record: the Repertoire preset appears the moment something passes
    // (§3.2), so republishing one without the other would leave the picker a
    // step behind.
    const publishPath = () =>
      set({ path: pathSnapshot(), presets: presetList(get().diatonicKey) })

    // Writes a path-record change through: persist and republish. Deliberately
    // does *not* touch `learning` — the pool is pinned for the life of a
    // session (see above), and the entry points re-derive it themselves.
    const commitPath = (next: PathProgressRecord) => {
      if (next === pathRecord) return
      pathRecord = next
      pathStore.set(pathRecord)
      publishPath()
    }
    // `${comboKey}:${grade}` for every climb already announced this session
    // (§7.3) — see judgeGradeUp. Cleared with the rest of the session
    // tallies, so a fresh session hears each climb again.
    let announcedGradeUps = new Set<string>()

    // A preset's chord order and its reconciled unlock record (§5.1), read
    // without touching the store's own. Split out of reloadProgress so
    // canDrillWorstOnly can ask about a preset the store hasn't switched to.
    const derivedProgress = (preset: Preset, combos: readonly Combo[]) => {
      const order = chordOrderOf(combos)
      const stored = progressStore.get(preset.id)
      const record = reconcileProgress(
        stored ?? initialProgress(order.length),
        order.length,
      )
      return { order, stored, record }
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
    const chordKeyLabel = (key: string): string => {
      const combo = expansion.combos.find((c) => poolChordKey(c) === key)
      if (combo === undefined) return key
      return songChordLabel(
        expansion.rootSpellings.get(combo.root) ?? spellRoot(combo.root),
        combo.typeId,
      )
    }

    // The §5.1 pass grade of a whole chord: the worst of its combos in the
    // current pool, from the persisted records — the same figure Home's In play
    // row shows (§7.1), so a chord can't read red there and pass here. Combos of
    // the chord with no history yet don't count against it (worstChordGrade
    // takes only the records that exist); with none at all it has no grade.
    // `projected` swaps in a record that hasn't been written yet, which is how
    // the pill calls the pass during the advance window (see judgeLearned).
    const chordGrade = (
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
            : stats.get(key)
        if (record !== null) records.push(record)
      }
      return worstChordGrade(records)
    }

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
      for (const event of sessionEvents) {
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
      set({ progress: progressSnapshot() })
      if (get().mode !== 'song' && get().prompt !== null) nextPrompt()
    }

    // Feeds a completed Practice prompt into the §5 unlock progress — as the
    // chord's grade, so it must run *after* stats.record(). On an unlock, the
    // queue is dropped so newly opened chords can enter the very next preview
    // refill (the pool changed, same rule as every other pool change).
    const applyProgress = (combo: Combo) => {
      const update = recordChordAttempt(
        chordOrder,
        progressRecord,
        poolChordKey(combo),
        chordGrade(poolChordKey(combo)),
      )
      if (!update.changed) return
      // The chord just passed this attempt (§5.1) — collect it for the Report.
      const passedLabel = chordKeyLabel(poolChordKey(combo))
      if (!sessionPassedLabels.includes(passedLabel)) {
        sessionPassedLabels.push(passedLabel)
      }
      const previousCount = progressRecord.unlockedCount
      progressRecord = update.record
      unlocked = unlockedChordKeys(chordOrder, progressRecord)
      progressStore.set(activePreset.id, progressRecord)
      set({ progress: progressSnapshot() })
      if (update.justUnlocked) {
        queue = []
        const newLabels = chordOrder
          .slice(previousCount, progressRecord.unlockedCount)
          .map(chordKeyLabel)
        for (const label of newLabels) {
          if (!sessionUnlockedLabels.includes(label)) {
            sessionUnlockedLabels.push(label)
          }
        }
        flashJustUnlocked(newLabels)
      }
    }

    // What the session did to the path, for the §4.4 chapter banner: the
    // chapter whose last combo passed, and the chapter whose song it stamped.
    let sessionChapterDone: string | null = null
    let sessionChapterStamped: string | null = null
    // Combos this session dealt as backfill rather than batch material (§3.1),
    // for the Report's "review mixed in" line.
    let sessionReviewKeys = new Set<string>()
    // Combos this session passed, as keys. The banner reads these in *track*
    // order rather than in the order they happened to pass: the deal is weighted
    // and random, so pass order would print C · G · F one session and C · F · G
    // the next, for a row that sits beside the batch chips.
    let sessionPassedKeys = new Set<string>()

    // Feeds a completed rep into the path (§2.3), as the *combo's* own grade —
    // so it must run after stats.record(), like applyProgress. Per combo rather
    // than per chord: the path's material varies by voicing, so there is
    // nothing to fold. A pass earned anywhere counts (§3.2), which is why this
    // runs for every recorded rep and not only inside the learning loop.
    const applyPathPass = (key: string, label: string) => {
      const record = stats.get(key)
      const update = recordComboPass(
        pathRecord,
        key,
        record === null ? null : comboMetrics(record).grade,
      )
      if (!update.changed) return
      // The path's own chip label ("C", "C/E", "G7") rather than the prompt's
      // fuller "F maj — Root Position": the chapter banner sits beside the
      // Today card and the batch chips, so they have to use the same names.
      const passedLabel = PATH_COMBO_INDEX.get(key)?.label ?? label
      if (!sessionPassedLabels.includes(passedLabel)) {
        sessionPassedLabels.push(passedLabel)
      }
      sessionPassedKeys.add(key)
      if (update.chapterComplete && update.chapter !== null) {
        sessionChapterDone = update.chapter.id
      }
      commitPath(update.record)
      // Only the learning loop redeals. Its pool membership is pinned for the
      // session, but a combo that just passed should stop being weighted as
      // outstanding from the next prompt on, so the preview is rebuilt.
      //
      // Free practice deliberately does *not*: a pass on the path changes
      // nothing about the preset being drilled, and re-rolling the upcoming row
      // under the player because some other bookkeeping moved would be a visible
      // twitch with no cause they could see.
      if (get().mode === 'path-learn') queue = []
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

    // Learn/Practice generate only from unlocked chords (§5); Song bypasses
    // this entirely (it draws from the preset's raw pool). "Worst chords only"
    // (Practice, §5/§7) then narrows within the unlocked set; an empty result
    // — every unlocked chord passed with nothing ever missed — falls back to
    // the whole unlocked pool.
    const pickPool = (): readonly Combo[] => {
      const state = get()
      // The learning loop deals its own pool (§3.1) — the batch backfilled to
      // three wide, captured at session start rather than re-derived per prompt.
      if (state.mode === 'path-learn') return learning.pool
      const available = filterUnlockedCombos(expansion.combos, unlocked)
      if (state.mode === 'practice' && state.worstOnly) {
        const pool = worstOnlyPool(available, chordOrder, progressRecord)
        if (pool.length > 0) return pool
      }
      return available
    }

    // The learning loop's generation parameters (§3.1). Elsewhere these are the
    // §5 defaults: window RECENT_WINDOW, no boost.
    const isLearningLoop = () => get().mode === 'path-learn'
    const pickWindow = () =>
      isLearningLoop() ? PATH_RECENT_WINDOW : RECENT_WINDOW
    const pickBoost = () =>
      isLearningLoop()
        ? (combo: Combo) =>
            learning.batchKeys.has(comboKey(combo)) ? BATCH_WEIGHT_BOOST : 1
        : undefined

    // A combo's root spelling. The *pool's* own spelling wins: a diatonic
    // preset in B major knows its iii is D♯m, and the path happens to declare
    // the same pitch class as E♭m in the key of D♭ — so consulting the path
    // first would rename the chord under a preset that knew better. The path's
    // spelling fills in only where the pool has no opinion, which is exactly
    // the `combos` pool (§3.2): it has no key of its own to spell from, and
    // that is how D♭ avoids reading C♯ on the Today card.
    const spellingFor = (combo: Combo) =>
      expansion.rootSpellings.get(combo.root) ??
      PATH_COMBO_INDEX.get(comboKey(combo))?.spelling

    // Which batch combos have already had their first look this session (§3.1).
    // Reset with the session, so returning to an unfinished batch tomorrow
    // shows the shapes again — the reps in between were the point of leaving.
    let introduced = new Set<string>()

    const nextPrompt = () => {
      const pool = pickPool()
      const window = pickWindow()
      const boost = pickBoost()
      if (queue.length === 0) {
        queue = fillQueue([], 1, pool, recentKeys, stats, rng, window, boost)
      }
      const combo = queue.shift()
      // Unreachable: fillQueue(_, 1, ...) always returns exactly one combo
      // for a non-empty pool, and pickPool() never returns an empty pool.
      if (combo === undefined) throw new Error('Upcoming queue was empty')
      currentCombo = combo
      const key = comboKey(combo)
      recentKeys.push(key)
      if (recentKeys.length > RECENT_WINDOW) recentKeys.shift()
      queue = fillQueue(
        queue,
        UPCOMING_COUNT,
        pool,
        recentKeys,
        stats,
        rng,
        window,
        boost,
      )
      // The §3.1 intro rep: a batch combo's *first* prompt of the session shows
      // its shape and records nothing, and every later rep of the same combo is
      // an ordinary hidden Practice rep. That is the Learn-then-Practice
      // choreography the player used to perform by hand, as a per-prompt tag.
      // Backfill never qualifies — it is passed material by definition.
      const introRep =
        get().mode === 'path-learn' &&
        learning.batchKeys.has(key) &&
        !introduced.has(key)
      if (introRep) introduced.add(key)
      if (get().mode === 'path-learn' && !learning.batchKeys.has(key)) {
        sessionReviewKeys.add(key)
      }
      const prompt = createPrompt(combo, spellingFor(combo), voicings())
      set({
        prompt,
        introRep,
        justLearned: false,
        upcoming: queue.map((c) => ({
          key: comboKey(c),
          label: comboLabel(c, spellingFor(c), voicings()),
          // Backfill in the learning loop is labelled *review* so a passed
          // chord reappearing never reads as a mistake (§3.1).
          review:
            get().mode === 'path-learn' && !learning.batchKeys.has(comboKey(c)),
        })),
      })
      machine.promptShown(prompt)
    }

    // Deal the next prompt, or raise the §7.3 ready gate instead when a
    // Practice session has nothing on screen yet: entering the Stage, and
    // every pool change that lands while the gate is still up (a preset
    // switch, a sheet toggle over a paused session). A prompt already showing
    // means the player is at the keyboard, so a pool change re-deals at once
    // as it always has — the gate is about the *first* prompt's clock.
    const dealOrGate = () => {
      // The learning loop gates like Practice: its first prompt of a *resumed*
      // session is a graded rep, and §7.3's rule is about every Stage entry, so
      // one tap before the first look is the cheap half of the trade.
      if (modeRecordsReps(get().mode) && get().prompt === null) {
        set({ awaitingReady: true })
        return
      }
      set({ awaitingReady: false })
      nextPrompt()
    }

    // Advance the session's played-prompt count (§7.2): every prompt that
    // advances counts a slot — correct or Learn.
    const bumpDone = () => set((state) => ({ done: state.done + 1 }))

    // Has the session run out? The learning loop's length *is* its batch
    // (§3.1) — the §7.2 picker doesn't apply, and it ends itself the moment
    // every combo in the batch has passed. Read after recordOutcome, which has
    // already written any pass this rep earned.
    const sessionEnded = (): boolean => {
      if (get().mode === 'path-learn') {
        return areCombosPassed(pathRecord, learning.batchKeys)
      }
      const length = get().sessionLength
      return length !== null && get().done >= length
    }

    // A prompt only completes through the 'advancing' phase. Learn-mode
    // prompts complete but feed nothing (§5): not the per-combo records, not
    // the session tallies or the report log. Returns whether a recorded prompt
    // was logged (a ✔ that counts a done slot on its own — the caller only
    // bumps done for the Learn case).
    const recordOutcome = (): boolean => {
      if (currentCombo === null || machine.state.phase !== 'advancing') {
        return false
      }
      // Learn records nothing (§5), and neither does an intro rep — the shape
      // was on the keys, so the rep measures copying, not recall (§3.1). It
      // still consumes a session slot, via bumpDone in onAdvance.
      if (!modeRecordsReps(get().mode) || get().introRep) return false
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
        spellingFor(currentCombo),
        voicings(),
      )
      stats.record(key, outcome, timeToCorrectMs)
      applyProgress(currentCombo)
      applyPathPass(key, label)
      sessionEvents.push({ key, label, outcome, timeToCorrectMs })
      // Defensive: a ✔ is recorded exactly once — clear the combo so a stray
      // second recordOutcome (still 'advancing') can't double-count it.
      currentCombo = null
      // The combo streak isn't touched here — it moves on the judgment edges
      // themselves (applyStreak below), which is what keeps the flash honest.
      set((state) => ({
        session: {
          prompts: state.session.prompts + 1,
          firstTrySuccesses:
            state.session.firstTrySuccesses + (outcome === 'first-try' ? 1 : 0),
          totalTimeToCorrectMs:
            state.session.totalTimeToCorrectMs + timeToCorrectMs,
        },
        done: state.done + 1,
      }))
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
      // An intro rep records no outcome, so it can neither extend a streak nor
      // break one — the shape was on the keys (§3.1).
      if (!modeRecordsReps(state.mode) || state.introRep) return
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
    // never reach the machine.
    interface ProjectedRep {
      key: string
      combo: Combo
      before: ComboStatRecord | null
      record: ComboStatRecord
    }

    const projectRep = (next: LifecycleState): ProjectedRep | null => {
      // The learning loop's graded reps get the ★ learned and grade-up news
      // too (§4.4) — they are ordinary counted reps. Its intro reps don't:
      // nothing was recorded, so there is nothing to announce.
      if (
        currentCombo === null ||
        !modeRecordsReps(get().mode) ||
        get().introRep
      ) {
        return null
      }
      const key = comboKey(currentCombo)
      const before = stats.get(key)
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
    // over the same records, with this rep projected in.
    const judgeLearned = ({ key, combo, record }: ProjectedRep): boolean => {
      // On the path the unit is the combo, and "still learning" means the path
      // hasn't latched it yet (§2.3) — the preset's chord order has nothing to
      // say about a chapter combo, and consulting it would silence ★ learned in
      // the one loop the callout was designed for.
      if (get().mode === 'path-learn' || isPathCombo(key)) {
        if (isComboPassed(pathRecord, key)) return false
        return isPassingGrade(comboMetrics(record).grade)
      }
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
      if (before === null || before.attempts < IMPROVED_MIN_ATTEMPTS)
        return null
      const from = comboMetrics(before).grade
      const to = comboMetrics(record).grade
      if (gradeRank(to) <= gradeRank(from)) return null
      const announced = `${key}:${to}`
      if (announcedGradeUps.has(announced)) return null
      announcedGradeUps.add(announced)
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
    const applyFlashes = (next: LifecycleState) => {
      if (next.phase !== 'advancing' || get().phase === 'advancing') return
      const rep = projectRep(next)
      const justLearned = rep !== null && judgeLearned(rep)
      if (justLearned !== get().justLearned) set({ justLearned })
      const gradeUp = rep === null ? null : judgeGradeUp(rep)
      if (gradeUp !== null || get().gradeUp !== null) set({ gradeUp })
    }

    const machine = new AttemptLifecycle({
      settings,
      now,
      // Learn mode — and the learning loop's intro rep (§3.1) — shows the
      // answer from the start (§7), so misses never escalate to the redundant
      // miss-3 reveal (§6.4).
      revealOnMisses: () => get().mode !== 'learn' && !get().introRep,
      onState: (state) => {
        // Both read the pre-transition state, so they run before the set()
        applyStreak(state)
        applyFlashes(state)
        set(state)
      },
      onAdvance: () => {
        // A Learn prompt — or an intro rep — records nothing but still
        // consumes a slot.
        if (!recordOutcome()) bumpDone()
        if (sessionEnded()) {
          concludeSession()
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
    // A chapter song checkpoint (§3.3) rather than a free-practice Song
    // session: the pool is pinned to the chapter's key and the progression is
    // its declared I–IV–V–I, the same four chords every phrase.
    let songChapterId: string | null = null
    let songFixed: readonly SongChord[] | null = null

    // The pool the engine draws from: the chapter's key for a checkpoint, the
    // active preset otherwise.
    const songPool = (): ChordPool => {
      if (songChapterId !== null) {
        const chapter = chapterById(songChapterId)
        if (chapter?.key !== null && chapter?.key !== undefined) {
          return { kind: 'diatonic', key: chapter.key }
        }
      }
      return activePreset.pool
    }

    const startSongEngine = () => {
      songEngine.start(songPool(), songFixed ?? undefined)
    }

    const songComboKey = (chord: SongChord): string =>
      comboKey({ root: chord.root, typeId: chord.typeId, voicingId: 'any' })

    // Chip/summary label: spelled from the chapter's key for a checkpoint and
    // from the expansion otherwise, so both keep §3.5's spellings.
    const songLabel = (chord: SongChord): string => {
      const chapterKey =
        songChapterId === null
          ? null
          : (chapterById(songChapterId)?.key ?? null)
      const spelling =
        chapterKey === null
          ? expansion.rootSpellings.get(chord.root)
          : chord.degree === null
            ? undefined
            : spellMajorScaleDegree(chapterKey, chord.degree)
      return songChordLabel(spelling ?? spellRoot(chord.root), chord.typeId)
    }

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
              spellingFor({
                root: chord.root,
                typeId: chord.typeId,
                voicingId: 'any',
              }),
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
        // A completed phrase stamps the chapter (§3.3) and ends the session:
        // a checkpoint is a task with a finish line, which is what makes the
        // stamp a reward rather than a chore, and it puts the 🎵 news on the
        // Report. `phraseSummary` is non-null exactly during the count-in that
        // follows a completed phrase, so it *is* the boundary edge.
        // Participation, not accuracy — the phrase counts whether the bars hit.
        if (songChapterId !== null && state.phraseSummary !== null) {
          const chapterId = songChapterId
          const stamped = stampChapterSong(pathRecord, chapterId)
          if (stamped !== pathRecord) {
            sessionChapterStamped = chapterId
            commitPath(stamped)
            set({ songJustStamped: true })
          }
          concludeSession()
        }
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
        sessionEvents.push({
          key,
          label: songLabel(chord),
          outcome,
          timeToCorrectMs: null,
        })
        set((state) => ({
          session: {
            prompts: state.session.prompts + 1,
            firstTrySuccesses: state.session.firstTrySuccesses + (hit ? 1 : 0),
            totalTimeToCorrectMs: state.session.totalTimeToCorrectMs,
          },
          done: state.done + 1,
        }))
      },
    })

    // Leaving Song: halt the clock (the in-flight bar is abandoned silently)
    // and drop the derived state.
    const leaveSong = () => {
      songEngine.stop()
      songProgression = []
      songPrompts = []
      songChapterId = null
      songFixed = null
      set({
        song: null,
        songChords: [],
        songSummary: null,
        hint: null,
        songChapterId: null,
      })
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
      pendingActiveMs += delta
      sessionActiveMs += delta // this session's share, for the report increment
      if (pendingActiveMs >= ACTIVE_FLUSH_MS) flushActivity()
    }

    const resetSession = () => {
      sessionEvents = []
      announcedGradeUps = new Set()
      sessionPassedLabels = []
      sessionUnlockedLabels = []
      sessionChapterDone = null
      sessionChapterStamped = null
      sessionReviewKeys = new Set()
      sessionPassedKeys = new Set()
      // Cleared with the session, so returning to an unfinished batch tomorrow
      // shows the shapes again (§3.1) — the reps in between are exactly what
      // makes the reminder worth having.
      introduced = new Set()
      sessionActiveMs = 0
      set({
        session: FRESH_SESSION,
        firstTryStreak: 0,
        done: 0,
        awaitingReady: false,
        introRep: false,
        songJustStamped: false,
      })
    }

    // Assemble the §7.4 Report from the just-ended session's tallies plus the
    // persisted lifetime totals. Called only when at least one prompt played.
    const buildReport = (): SessionReport => {
      const records = activity.records()
      let lifetimePrompts = 0
      let lifetimeActiveMinutes = 0
      for (const record of Object.values(records)) {
        lifetimePrompts += record.prompts
        lifetimeActiveMinutes += record.activeMinutes
      }
      return buildSessionReport({
        mode: get().mode,
        promptsPlayed: get().done,
        events: sessionEvents,
        records,
        todayKey: localDateKey(new Date(now())),
        lifetime: {
          prompts: lifetimePrompts,
          activeMinutes: lifetimeActiveMinutes,
        },
        increment: {
          prompts: sessionEvents.length,
          activeMinutes: sessionActiveMs / 60_000,
        },
        passedLabels: sessionPassedLabels,
        unlocked:
          sessionUnlockedLabels.length > 0
            ? {
                labels: [...sessionUnlockedLabels],
                unlocked: progressRecord.unlockedCount,
                passed: progressRecord.masteredIndices.length,
                total: chordOrder.length,
              }
            : null,
        chords: reportChords(),
        setAside: setAsideChords(),
        goal: currentGoal(),
        chapter: reportChapter(),
        reviewKeys: [...sessionReviewKeys],
      })
    }

    // The §4.4 chapter banner: what this session did to the path. Null when it
    // touched nothing — a free-practice session on chords the track doesn't
    // declare, or one that passed nothing.
    const reportChapter = () => {
      const position = pathPosition(pathRecord)
      const done =
        sessionChapterDone === null ? null : chapterById(sessionChapterDone)
      const stamped =
        sessionChapterStamped === null
          ? null
          : chapterById(sessionChapterStamped)
      if (
        done === null &&
        stamped === null &&
        sessionPassedLabels.length === 0
      ) {
        return null
      }
      const song = songOffer(pathRecord)
      return {
        chapterTitle: (done ?? stamped ?? position.chapter)?.title ?? null,
        chapterComplete: done !== null,
        justStamped: stamped !== null,
        learnedLabels: passedCombos(pathRecord)
          .filter((pathCombo) =>
            sessionPassedKeys.has(comboKey(pathCombo.combo)),
          )
          .map((pathCombo) => pathCombo.label),
        nextChapterTitle:
          done === null ? null : (position.chapter?.title ?? null),
        nextBatchLabels: position.batch.map((pathCombo) => pathCombo.label),
        triadsPassed: passedTriadCount(pathRecord),
        triadsTotal: PATH_TRIAD_TOTAL,
        songChapterId: song?.id ?? null,
        songChapterTitle: song?.title ?? null,
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
      set({ prompt: null, justLearned: false, awaitingReady: false })
    }

    // End the current session (§7.2): freeze practice and show the Report — or
    // return with no report when zero prompts played. The caller/endSession has
    // already recorded any pending ✔.
    const concludeSession = () => {
      haltSession()
      set({ report: get().done > 0 ? buildReport() : null })
    }

    // Abandon whatever is in flight with no Report, so the next start() begins
    // fresh — what every path entry point does before setting up its own
    // session, and what discardSession() exposes to the Start / Go again path.
    const discardLive = () => {
      if (!sessionLive) return
      recordOutcome() // a pending ✔ still counts against the lifetime stats
      haltSession()
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
      // Outside a session this is pure config (Home's Change control, the
      // sheet's preset picker) — the pool is picked up by the next start().
      if (!sessionLive) return
      // A live song rebuilds from the new pool with a fresh count-in; a
      // paused one (no clock) picks the pool up on the next start().
      if (get().mode === 'song') {
        songEngine.setPool(songPool())
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
      mode: 'practice',
      song: null,
      songChords: [],
      songSummary: null,
      worstOnly: false,
      sessionLength: DEFAULT_SESSION_LENGTH,
      done: 0,
      report: null,
      session: FRESH_SESSION,
      firstTryStreak: 0,
      upcoming: [],
      goal: currentGoal(),
      progress: progressSnapshot(),
      justUnlocked: false,
      justUnlockedLabels: [],
      gradeUp: null,
      introRep: false,
      path: pathSnapshot(),
      songChapterId: null,
      songJustStamped: false,

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
          startSongEngine()
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
          set({ diatonicKey: sanitized, presets: presetList(sanitized) })
        }
      },

      setMode(mode: SessionMode) {
        if (mode === get().mode) return
        const leavingSong = get().mode === 'song'
        // A pending ✔ counts under the outgoing mode's rules (recordOutcome
        // still sees the old mode); the current prompt is replaced so a
        // Learn reveal can't be answered for Practice credit.
        recordOutcome()
        queue = [] // the pool can change (worstOnly is per-mode)
        // Leaving the mode ends the run (§7.3). Only Practice can break a
        // streak — Learn records no outcome at all and Song is clock-paced —
        // so without this a detour parks the count and hands it back intact,
        // which is a free pass on a counter nothing else forgives.
        if (get().firstTryStreak > 0) set({ firstTryStreak: 0 })
        if (!sessionLive) {
          set({ mode })
          return
        }
        if (mode === 'song') {
          machine.stop() // clears phase/hint/reactionMs via onState
          set({ mode, upcoming: [] })
          startSongEngine()
          return
        }
        set({ mode })
        if (leavingSong) leaveSong()
        dealOrGate()
      },

      setWorstOnly(on: boolean) {
        if (on === get().worstOnly) return
        if (get().mode === 'song') return // not rendered in Song; stay safe
        recordOutcome()
        queue = []
        set({ worstOnly: on })
        if (sessionLive) dealOrGate()
      },

      setSessionLength(length: number | null) {
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
        discardLive()
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
        // Song isn't gated (§6.5) and a paused store has no prompt to
        // re-deal; a live Learn/Practice prompt redeals from the narrowed
        // pool so a now-locked chord isn't left on screen.
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

      // ─── The guided path (§3, §4) ─────────────────────────────────────────

      startPathLearn() {
        // Re-derive first: a Today card left open while the batch finished
        // elsewhere (daily or free practice, §3.2) must not open an empty
        // session. The caller routes to practice instead.
        // The check is the *batch*, not the pool: a complete path still yields
        // a three-wide pool of backfill, so asking whether there is anything to
        // deal would happily open a session with nothing to learn.
        if (isPathComplete(pathRecord)) return false
        learning = learningPool(pathRecord)
        if (learning.pool.length === 0) return false
        discardLive()
        set({
          mode: 'path-learn',
          worstOnly: false,
          upcoming: [],
        })
        return true
      },

      startRepertoire() {
        if (repertoireCombos(pathRecord).length === 0) return false
        discardLive()
        // Daily practice is not a session type (§3.2): it is the v9 Practice
        // session at ∞ on one derived preset, so the goal bar and everything
        // else about an endless session already applies.
        set({ mode: 'practice', worstOnly: false, sessionLength: null })
        applySelection(REPERTOIRE_PRESET_ID, get().diatonicKey)
        return true
      },

      startChapterSong(chapterId: string) {
        const chapter = chapterById(chapterId)
        if (chapter === undefined || chapter.songDegrees === null) return false
        if (chapter.key === null) return false
        discardLive()
        songChapterId = chapterId
        songFixed = chapterSong(chapter)
        set({ mode: 'song', songChapterId: chapterId, upcoming: [] })
        return true
      },

      chapterRows() {
        return chapterRows(pathRecord, stats)
      },

      setPathComboAside(key: string) {
        recordOutcome()
        commitPath(setAsideCombo(pathRecord, key))
      },

      openPathCombo(key: string) {
        recordOutcome()
        commitPath(openCombo(pathRecord, key))
      },

      canSetPathComboAside(key: string) {
        return canSetAsideCombo(pathRecord, key)
      },

      resetPath() {
        recordOutcome()
        pathStore.reset()
        // Not emptyPathProgress() straight into pathRecord: reset() clears the
        // calibration latch, so re-reading it and calibrating is what returns
        // the player to where their stats put them rather than to chapter 1
        // (§5.2). The same two lines the store's construction runs.
        pathRecord = calibratePath(
          reconcilePathProgress(pathStore.get()),
          stats,
        )
        pathStore.set(pathRecord)
        learning = learningPool(pathRecord)
        queue = []
        recentKeys = []
        publishPath()
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
