import {
  formatSpelling,
  getBuiltInVoicingRule,
  getChordType,
  matches,
  MAJOR_SCALE_SEMITONES,
  pitchClass,
  type Chord,
  type ChordTypeId,
  type NoteSpelling,
  type PitchClass,
} from '../theory'
import type { Rng } from './generator'
import { DIATONIC_QUALITIES } from './presets'
import { sanitizeSongTempoBpm, type PracticeSettings } from './settings'

// Song mode (DESIGN.md §6.5): a short diatonic progression looped against a
// metronome. Where the §6.2 lifecycle is self-paced (the machine waits for
// the player), this engine is clock-paced — the bar boundary judges and the
// music moves on whether the chord landed or not. No arming, no stall timer,
// no retry, no hint escalation.

export const SONG_BEATS_PER_BAR = 4
export const SONG_LOOPS_PER_PHRASE = 4

// One chord of a progression: the diatonic degree (0 = I … 6 = vii°, though
// vii° is never generated) plus its resolved root and quality.
export interface SongChord {
  degree: number
  root: PitchClass
  typeId: ChordTypeId
}

// Per-chord hit tally across one phrase's loops, shown during the next
// count-in (§6.5 phrase summary).
export interface PhraseChordSummary {
  chord: SongChord
  hits: number
  loops: number
}

export interface SongState {
  progression: readonly SongChord[]
  // True during the one-bar count-in that precedes every progression.
  countingIn: boolean
  loopIndex: number // 0..SONG_LOOPS_PER_PHRASE-1
  barIndex: number // 0..progression.length-1 (0 during count-in)
  // Monotonic beat counter since start() — lets the app edge dedupe
  // metronome ticks and retrigger the chip pulse.
  beat: number
  beatInBar: number // 0..SONG_BEATS_PER_BAR-1; 0 is the accented beat
  // Current loop's per-bar results, stamped at each bar's END (§6.5: the
  // chip is stamped "as its bar completes"); null = not yet finished.
  results: readonly (boolean | null)[]
  // Increments the moment a bar first matches — the ✔-chime trigger; the
  // visual stamp still waits for the bar boundary.
  hitCount: number
  // Previous phrase's tallies; non-null only during a count-in that follows
  // a completed phrase.
  phraseSummary: readonly PhraseChordSummary[] | null
}

export interface SongEngineHost {
  // Read fresh at every beat/judgment: tempo applies from the next beat,
  // chord count from the next progression, match toggles immediately.
  settings(): PracticeSettings
  now(): number
  rng: Rng
  onState(state: SongState): void
  // A judged bar ended — the store records the per-combo stat here.
  onBarResult(chord: SongChord, hit: boolean): void
}

const ROMAN_NUMERALS = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'] as const

export function romanNumeral(degree: number): string {
  return ROMAN_NUMERALS[degree] ?? ''
}

// Compact chip label (§7: "C — G — Am — F"). Only maj/min occur in
// generated progressions (vii° is excluded), but ° keeps a dim readable.
export function songChordLabel(
  spelling: NoteSpelling,
  typeId: ChordTypeId,
): string {
  const suffix = typeId === 'maj' ? '' : typeId === 'min' ? 'm' : '°'
  return `${formatSpelling(spelling)}${suffix}`
}

function songChordAt(key: PitchClass, degree: number): SongChord {
  return {
    degree,
    root: pitchClass(key + (MAJOR_SCALE_SEMITONES[degree] ?? 0)),
    typeId: DIATONIC_QUALITIES[degree] ?? 'maj',
  }
}

// §6.5 progression generation: always starts on I, excludes vii°, no
// repeated chord, the rest uniform-random.
export function buildProgression(
  key: PitchClass,
  chordCount: number,
  rng: Rng = Math.random,
): SongChord[] {
  const count = Math.min(Math.max(Math.round(chordCount), 2), 4)
  const candidates = [1, 2, 3, 4, 5] // ii iii IV V vi
  const chords = [songChordAt(key, 0)]
  while (chords.length < count) {
    const index = Math.min(
      Math.floor(rng() * candidates.length),
      candidates.length - 1,
    )
    const degree = candidates.splice(index, 1)[0]
    if (degree !== undefined) chords.push(songChordAt(key, degree))
  }
  return chords
}

// The clock. Beats are scheduled against absolute timestamps
// (nextBeatAt += interval, not now + interval) so setTimeout lateness never
// accumulates as drift. Judging: a bar is a hit if at any moment during it
// the held notes satisfy the chord under the `any` rule — evaluated at the
// bar-boundary tick (legato: notes still down from the previous bar count)
// and on every held-set change within the bar.
export class SongEngine {
  private readonly host: SongEngineHost
  private readonly anyRule = getBuiltInVoicingRule('any')

  private key: PitchClass = 0
  private progression: SongChord[] = []
  private countingIn = true
  private loopIndex = 0
  private barIndex = 0
  private beat = -1
  private beatInBar = -1
  private results: (boolean | null)[] = []
  private hitsPerChord: number[] = []
  private hitCount = 0
  private currentBarHit = false
  private phraseSummary: PhraseChordSummary[] | null = null

  private held: ReadonlySet<number> = new Set()
  private timer: ReturnType<typeof setTimeout> | null = null
  private nextBeatAt = 0

  constructor(host: SongEngineHost) {
    this.host = host
  }

  get state(): SongState {
    return {
      // Emitted by reference on purpose: the array is replaced wholesale per
      // progression, never mutated, so consumers can use identity to detect
      // a new progression.
      progression: this.progression,
      countingIn: this.countingIn,
      loopIndex: this.loopIndex,
      barIndex: this.barIndex,
      beat: this.beat,
      beatInBar: this.beatInBar,
      results: [...this.results],
      hitCount: this.hitCount,
      phraseSummary:
        this.phraseSummary === null ? null : [...this.phraseSummary],
    }
  }

  // Begin (or restart) at this key: fresh progression, count-in, beat 0 now.
  start(key: PitchClass): void {
    this.stop()
    this.key = key
    this.hitCount = 0
    this.beat = -1
    this.restartPhrase(null)
  }

  // A key change mid-song rebuilds the progression and counts in again; the
  // in-flight bar is abandoned silently, nothing recorded.
  setKey(key: PitchClass): void {
    if (this.timer === null) return
    this.key = key
    this.restartPhrase(null)
  }

  heldChange(held: ReadonlySet<number>): void {
    this.held = held
    if (
      this.timer === null ||
      this.countingIn ||
      this.currentBarHit ||
      this.progression.length === 0
    ) {
      return
    }
    if (this.judgeHeld()) this.emit()
  }

  // Halt without recording — mode switch, pause, teardown. Held keys stay
  // tracked so a later start() judges legato correctly. No emission: the
  // caller owns whatever state replaces the song view.
  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private restartPhrase(summary: PhraseChordSummary[] | null): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.progression = buildProgression(
      this.key,
      this.host.settings().songChordCount,
      this.host.rng,
    )
    this.countingIn = true
    this.loopIndex = 0
    this.barIndex = 0
    this.beatInBar = -1
    this.results = this.progression.map(() => null)
    this.hitsPerChord = this.progression.map(() => 0)
    this.currentBarHit = false
    this.phraseSummary = summary
    this.nextBeatAt = this.host.now()
    this.tick()
  }

  private tick(): void {
    this.timer = null
    this.beatInBar += 1
    if (this.beatInBar >= SONG_BEATS_PER_BAR) {
      this.beatInBar = 0
      this.advanceBar()
      // A phrase rollover restarted the clock via restartPhrase(), which
      // already ticked beat 0 of the new count-in and rescheduled — a live
      // timer here means this tick's work is done.
      if (this.timer !== null) return
    }
    this.beat += 1
    this.emit()
    this.scheduleNextBeat()
  }

  private advanceBar(): void {
    if (this.countingIn) {
      // Count-in over — bar 0 of loop 0 starts on this beat.
      this.countingIn = false
      this.phraseSummary = null
      this.beginBar()
      return
    }
    this.finalizeBar()
    if (this.barIndex + 1 < this.progression.length) {
      this.barIndex += 1
    } else if (this.loopIndex + 1 < SONG_LOOPS_PER_PHRASE) {
      this.loopIndex += 1
      this.barIndex = 0
      this.results = this.progression.map(() => null)
    } else {
      // Phrase complete: tally, regenerate, count in again (§6.5). The beat
      // counter carries across phrases (only start() resets it).
      this.restartPhrase(
        this.progression.map((chord, i) => ({
          chord,
          hits: this.hitsPerChord[i] ?? 0,
          loops: SONG_LOOPS_PER_PHRASE,
        })),
      )
      return
    }
    this.beginBar()
  }

  private beginBar(): void {
    this.currentBarHit = false
    // Judge the already-held set immediately — legato changes count.
    this.judgeHeld()
  }

  private finalizeBar(): void {
    const chord = this.progression[this.barIndex]
    if (chord === undefined) return
    this.results[this.barIndex] = this.currentBarHit
    if (this.currentBarHit) {
      this.hitsPerChord[this.barIndex] =
        (this.hitsPerChord[this.barIndex] ?? 0) + 1
    }
    this.host.onBarResult(chord, this.currentBarHit)
  }

  private judgeHeld(): boolean {
    if (this.currentBarHit || this.held.size === 0) return false
    const songChord = this.progression[this.barIndex]
    if (songChord === undefined) return false
    const chord: Chord = {
      root: songChord.root,
      type: getChordType(songChord.typeId),
    }
    if (!matches(this.held, chord, this.anyRule, this.host.settings())) {
      return false
    }
    this.currentBarHit = true
    this.hitCount += 1
    return true
  }

  private scheduleNextBeat(): void {
    const bpm = sanitizeSongTempoBpm(this.host.settings().songTempoBpm)
    this.nextBeatAt += 60_000 / bpm
    const delay = Math.max(0, this.nextBeatAt - this.host.now())
    this.timer = setTimeout(() => this.tick(), delay)
  }

  private emit(): void {
    this.host.onState(this.state)
  }
}
