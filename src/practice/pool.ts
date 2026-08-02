// The pool a session draws from (DESIGN.md §4, §5): a preset resolved against
// the current library, expanded into combos, ordered for the unlock queue, and
// paired with the §5.1 progress record that says which of it is in play.
//
// Those four things are only ever meaningful together — a chord order without
// its record can't say what's unlocked, a record without the expansion can't
// say what a chord is called — so they are one value. It is **immutable**: a
// progress change produces a new Pool (`withProgress`), which is what keeps the
// derived unlock set from drifting out of step with the record it came from.
//
// The same value answers questions about the *active* preset and about one the
// session sheet has merely drafted (§7.2). That is the point of resolving it
// per (presetId, key) rather than holding one: a draft is not a special case,
// it is another pool.
//
// Session state never lives here. A stats source, a session's event log, a rep
// that hasn't been recorded yet — all arrive as arguments.

import { comboKey, type Combo } from './combos'
import { expandPreset, type Preset } from './presets'
import {
  canSetAside,
  chordOrderOf,
  chordPassList,
  chordsOpenedBefore,
  filterUnlockedCombos,
  initialProgress,
  notPassedChordKeys,
  poolChordKey,
  reconcileProgress,
  unlockedChordKeys,
  type ChordPassEntry,
  type PresetProgressRecord,
} from './progress'
import {
  defaultLearnSelection,
  learnFillerChords,
  learnPoolChordKeys,
  selectableLearnChords,
} from './learnLoop'
import { comboLabel, createPrompt, type Prompt } from './prompts'
import { songChordLabel } from './song'
import {
  rankWorstCombos,
  worstChordDisplayGrade,
  worstChordGrade,
  type ComboGrade,
  type ComboStatRecord,
  type ComboStatsSource,
  type DisplayGrade,
} from './stats'
import type { ReportChord } from './report'
import type { SessionEvent } from './session'
import {
  spellRoot,
  type NoteSpelling,
  type PitchClass,
  type VoicingLibrary,
} from '../theory'

// The §5 unlock standing of a pool, as the top-bar chip and Home read it.
export interface PoolProgress {
  unlocked: number
  passed: number
  total: number
  // Unlocked chords the player has set aside (§5.2). Part of the snapshot so a
  // set-aside — which moves neither of the counts above — still changes this
  // object, and Home's In play row re-derives from it.
  setAside: number
}

// One chord's status in the unlock drill-down (§7), with its display label
// resolved through this pool's spelling.
export interface PoolChordEntry extends ChordPassEntry {
  label: string
}

// Swapping in a rep that hasn't been written yet, which is how the ✔ pill calls
// a pass during the advance window (§7.3) — and, for the learn loop, against
// its own session-local records rather than the persisted ones (§5.4).
export interface GradeLens {
  source?: ComboStatsSource
  projected?: { key: string; record: ComboStatRecord }
}

export interface PoolParts {
  preset: Preset
  combos: readonly Combo[]
  rootSpellings: ReadonlyMap<PitchClass, NoteSpelling>
  chordOrder: readonly string[]
  progressRecord: PresetProgressRecord
  // Did reconciling the stored record against the real pool size change it?
  // The caller persists the self-heal so it happens once rather than on every
  // load — and only for the pool it actually switched to, never for a draft.
  reconciled: boolean
  voicings: VoicingLibrary
  stats: ComboStatsSource
}

export class Pool {
  readonly preset: Preset
  readonly combos: readonly Combo[]
  readonly chordOrder: readonly string[]
  readonly progressRecord: PresetProgressRecord
  readonly reconciled: boolean
  readonly #rootSpellings: ReadonlyMap<PitchClass, NoteSpelling>
  readonly #voicings: VoicingLibrary
  readonly #stats: ComboStatsSource
  // Derived from the record, so it is settled once per value rather than on
  // every prompt — the whole reason a progress change builds a new Pool.
  #inPlay: readonly Combo[] | null = null

  constructor(parts: PoolParts) {
    this.preset = parts.preset
    this.combos = parts.combos
    this.chordOrder = parts.chordOrder
    this.progressRecord = parts.progressRecord
    this.reconciled = parts.reconciled
    this.#rootSpellings = parts.rootSpellings
    this.#voicings = parts.voicings
    this.#stats = parts.stats
  }

  get presetId(): string {
    return this.preset.id
  }

  // The same pool under a moved progress record (§5.1): a chord passed, a batch
  // unlocked, one set aside by hand. Everything derived from the record —
  // in-play, the pass list, the learn choices — comes out of the new value, so
  // none of it can be left behind.
  withProgress(next: PresetProgressRecord): Pool {
    return new Pool({
      preset: this.preset,
      combos: this.combos,
      rootSpellings: this.#rootSpellings,
      chordOrder: this.chordOrder,
      progressRecord: next,
      reconciled: false, // a deliberate move is not a reconciliation
      voicings: this.#voicings,
      stats: this.#stats,
    })
  }

  // What generation may draw from (§5): unlocked and not set aside.
  get inPlay(): readonly Combo[] {
    this.#inPlay ??= filterUnlockedCombos(
      this.combos,
      unlockedChordKeys(this.chordOrder, this.progressRecord),
    )
    return this.#inPlay
  }

  get progress(): PoolProgress {
    return {
      unlocked: this.progressRecord.unlockedCount,
      passed: this.progressRecord.masteredIndices.length,
      total: this.chordOrder.length,
      setAside: this.progressRecord.setAsideIndices.length,
    }
  }

  // ---- spelling -----------------------------------------------------------

  // This pool's spelling of a root — the diatonic pools respell to their key
  // (§3.5), everything else takes the default.
  rootSpelling(root: PitchClass): NoteSpelling {
    return this.#rootSpellings.get(root) ?? spellRoot(root)
  }

  // A combo's full display name, voicing included (§7 prompt area).
  comboLabel(combo: Combo): string {
    return comboLabel(
      combo,
      this.#rootSpellings.get(combo.root),
      this.#voicings,
    )
  }

  promptFor(combo: Combo): Prompt {
    return createPrompt(
      combo,
      this.#rootSpellings.get(combo.root),
      this.#voicings,
    )
  }

  // Compact "Am"-style label for a chord-order key — the unlock toast, the
  // learn set, the Report's chord lines. Falls back to the key itself for a
  // chord this pool doesn't contain, which a stale selection can still name.
  label(chordKey: string): string {
    const combo = this.combos.find((c) => poolChordKey(c) === chordKey)
    if (combo === undefined) return chordKey
    return songChordLabel(this.rootSpelling(combo.root), combo.typeId)
  }

  // ---- grades -------------------------------------------------------------

  // The §5.1 pass grade of a whole chord: the worst of its combos in this pool
  // — the same figure Home's In play row shows (§7.1), so a chord can't read
  // red there and pass here. Combos with no history don't count against it;
  // with none at all the chord has no grade.
  chordGrade(chordKey: string, lens: GradeLens = {}): ComboGrade | null {
    const source = lens.source ?? this.#stats
    const records: ComboStatRecord[] = []
    for (const combo of this.combos) {
      if (poolChordKey(combo) !== chordKey) continue
      const key = comboKey(combo)
      const record =
        lens.projected?.key === key ? lens.projected.record : source.get(key)
      if (record !== null) records.push(record)
    }
    return worstChordGrade(records)
  }

  // The same fold through the display rule (§7.5) — an unproven combo reads
  // `new`, not F. What the §5.2 suggestion judges on: a chord that has barely
  // been played needs reps, not a bench.
  displayGrade(chordKey: string): DisplayGrade | null {
    const records: ComboStatRecord[] = []
    for (const combo of this.combos) {
      if (poolChordKey(combo) !== chordKey) continue
      const record = this.#stats.get(comboKey(combo))
      if (record !== null) records.push(record)
    }
    return worstChordDisplayGrade(records)
  }

  // ---- narrowings ---------------------------------------------------------

  // The §5/§7 "worst chords only" pool: chords with a miss on the record, plus
  // the chords still being learned (§5.1: unlocked, not yet passed). A chord
  // you've never passed belongs in a weak-spots drill even with a clean sheet —
  // most likely you've barely played it, and leaving it out means the toggle
  // can only revisit old mistakes and never the gaps. Worst first, so the
  // ranking still leads the weighted draw. Empty means the toggle has nothing
  // to narrow to, which is both what makes generation fall back to the whole
  // pool and what disables the toggle in the sheet.
  worstOnly(): readonly Combo[] {
    const available = this.inPlay
    const worst = rankWorstCombos(available, this.#stats, available.length)
    const worstKeys = new Set(worst.map(({ combo }) => comboKey(combo)))
    const notPassed = notPassedChordKeys(this.chordOrder, this.progressRecord)
    const learning = available.filter(
      (combo) =>
        notPassed.has(poolChordKey(combo)) && !worstKeys.has(comboKey(combo)),
    )
    return [...worst.map(({ combo }) => combo), ...learning]
  }

  // The learn loop's pool (§5.4): the selected chords plus the learned ones
  // dealt alongside them to keep three in play. Empty when the selection names
  // nothing this pool still contains — the caller falls back to the whole pool.
  learnSet(selection: readonly string[]): readonly Combo[] {
    const keys = learnPoolChordKeys(
      this.chordOrder,
      this.progressRecord,
      selection,
    )
    return this.inPlay.filter((combo) => keys.has(poolChordKey(combo)))
  }

  // ---- progress questions -------------------------------------------------

  // Every pool chord in unlock order with its locked/unlocked/passed status and
  // display label — the unlock chip's drill-down (§7) and Home's In play row.
  passList(): PoolChordEntry[] {
    return chordPassList(this.chordOrder, this.progressRecord).map((entry) => ({
      ...entry,
      label: this.label(entry.key),
    }))
  }

  // May this chord be set aside right now (§5.2)? False once doing so would
  // leave too little in play.
  canSetAside(chordKey: string): boolean {
    return canSetAside(this.chordOrder, this.progressRecord, chordKey)
  }

  // How many chords ahead of a locked one would open with it — the unlock
  // frontier is a prefix (§5.1), so the control can say so.
  openedWith(chordKey: string): number {
    return chordsOpenedBefore(this.chordOrder, this.progressRecord, chordKey)
  }

  // The benched chords in unlock order (§5.2), for the Report's bring-back
  // offer.
  setAsideChords(): { chordKey: string; label: string }[] {
    return chordPassList(this.chordOrder, this.progressRecord)
      .filter((entry) => entry.setAside)
      .map((entry) => ({ chordKey: entry.key, label: this.label(entry.key) }))
  }

  // ---- the learn loop's picker (§5.4) -------------------------------------

  // The chords the picker may offer: everything in play, with their labels and
  // current pass state.
  learnChoices(): PoolChordEntry[] {
    return selectableLearnChords(this.chordOrder, this.progressRecord).map(
      (entry) => ({ ...entry, label: this.label(entry.key) }),
    )
  }

  // What the picker opens with: the in-play chords not yet passed, or the most
  // recently reached ones when there is nothing waiting.
  defaultLearnSet(): readonly string[] {
    return defaultLearnSelection(this.chordOrder, this.progressRecord)
  }

  // The learned chords that would be dealt alongside a selection to keep the
  // pool at three, as labels for the sheet's summary line.
  fillerLabels(selection: readonly string[]): readonly string[] {
    return learnFillerChords(
      this.chordOrder,
      this.progressRecord,
      selection,
    ).map((key) => this.label(key))
  }

  // ---- the Report (§7.4) --------------------------------------------------

  // The chords a session actually played, folded from its per-combo events,
  // with what the §5.2 suggestion rule needs to judge them. The log is the
  // session's; the spelling, the grades and the bench rule are the pool's.
  reportChords(events: readonly SessionEvent[]): ReportChord[] {
    const chordOf = new Map<string, string>()
    for (const combo of this.combos) {
      chordOf.set(comboKey(combo), poolChordKey(combo))
    }
    const misses = new Map<string, number>()
    const played: string[] = []
    for (const event of events) {
      const chordKey = chordOf.get(event.key)
      if (chordKey === undefined) continue
      if (!played.includes(chordKey)) played.push(chordKey)
      if (event.outcome === 'missed') {
        misses.set(chordKey, (misses.get(chordKey) ?? 0) + 1)
      }
    }
    return played.map((chordKey) => ({
      chordKey,
      label: this.label(chordKey),
      grade: this.displayGrade(chordKey),
      misses: misses.get(chordKey) ?? 0,
      canSetAside: this.canSetAside(chordKey),
    }))
  }
}

// What resolution needs from the layers around it: the preset list for a key
// (built-ins plus the custom library), the voicing library those presets
// reference, the stored §5.1 progress, the unlock-order setting, and the
// persisted per-combo records the grades and the worst-only narrow read.
export interface PoolSources {
  presets: (diatonicKey: PitchClass) => readonly Preset[]
  voicings: () => VoicingLibrary
  storedProgress: (presetId: string) => PresetProgressRecord | null
  unlockByFifths: () => boolean
  stats: ComboStatsSource
}

export type PoolResolver = (presetId: string, diatonicKey: PitchClass) => Pool

export function createPoolResolver(sources: PoolSources): PoolResolver {
  return (presetId, diatonicKey) => {
    const list = sources.presets(diatonicKey)
    const first = list[0]
    if (!first) throw new Error('No presets defined')
    const voicings = sources.voicings()
    let preset = list.find((p) => p.id === presetId) ?? first
    let expansion = expandPreset(preset, voicings)
    // A custom preset can expand to nothing (its rules were edited under it, or
    // persisted junk); fall back to the first preset — built-ins always have
    // satisfiable combos.
    if (expansion.combos.length === 0 && preset !== first) {
      preset = first
      expansion = expandPreset(preset, voicings)
    }

    // Circle-of-fifths unlock order (§5.1) applies only to root-ordered
    // (product) pools — diatonic/explicit orders are deliberate as-is.
    const chordOrder = chordOrderOf(
      expansion.combos,
      sources.unlockByFifths() && preset.pool.kind === 'product'
        ? 'fifths'
        : 'pool',
    )
    // A custom pool can shrink under its saved progress, so what was stored is
    // reconciled against the real size before anything reads it.
    const stored = sources.storedProgress(preset.id)
    const progressRecord = reconcileProgress(
      stored ?? initialProgress(chordOrder.length),
      chordOrder.length,
    )
    const reconciled =
      stored !== null &&
      JSON.stringify(stored) !== JSON.stringify(progressRecord)

    return new Pool({
      preset,
      combos: expansion.combos,
      rootSpellings: expansion.rootSpellings,
      chordOrder,
      progressRecord,
      reconciled,
      voicings,
      stats: sources.stats,
    })
  }
}
