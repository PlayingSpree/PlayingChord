import type { PromptOutcome } from './stats'

// Session modes (DESIGN.md §7): Learn shows the example voicing from the
// start and is stats-neutral — completed prompts feed neither the per-combo
// records nor the session tallies (§5), though active minutes still count.
// The two practice modes hide the voicing and record everything: **daily**
// drills every chord already learned, across every preset, under a time cap
// (§5.3), and **free** is the configured drill — a preset, its unlock gate and
// its narrows, at whatever length was picked (§7.2). Song (§6.5) is
// clock-paced: a looped diatonic progression judged per bar.
export type SessionMode = 'learn' | 'daily' | 'free' | 'song'

// What each mode *does*, as data (§7). The modes differ at a couple of dozen
// decision points — whether a rep moves the unlock queue, which stats it lands
// in, whether the ✔ pill may announce a pass — and those differences used to
// be spelled as `mode === '…'` at each point, so what a mode is could only be
// read by finding all of them, and adding one meant finding them again.
//
// Deliberately *not* here: the branches that pick which engine to drive
// (Song's clock beside the self-paced attempt machine) and which pool to
// generate from. Those have a different body per mode rather than a shared
// body under a trait test, so a field would rename the condition and remove
// nothing — they still name Song and daily and Learn outright.
export interface ModePolicy {
  // Which length ends the session (§7.2), resolved by effectiveLength below:
  // the length drafted in the session sheet, the persisted daily cap (§5.3),
  // or none at all — Learn ends on its set (§5.4) and Song on the End button.
  length: 'drafted' | 'dailyCap' | 'none'
  // Where a completed self-paced rep lands: the persisted per-combo records,
  // or the learn loop's session-local ones (§5.4). `null` is Song, which has
  // no self-paced reps to place — its bars are judged on the clock and
  // recorded through their own path (§6.5).
  statsSource: 'persisted' | 'session' | null
  // Does the first prompt wait for the player (§7.3)? Only worth a gate where
  // a time-to-correct is being recorded against the walk-up to the keyboard.
  gatesOnReady: boolean
  // Does a first-try ✔ carry the combo streak (§7.3)?
  streaks: boolean
  // Is a rep judged on pace — the ✔ pill's slow/fast chips (§7.3)?
  graded: boolean
  // Is the example voicing shown from the start (§7), rather than earned at
  // the miss-3 reveal (§6.4)?
  revealsAnswer: boolean
  // Does a completed rep move the §5 unlock queue — and, with it, does the
  // mode govern the selected preset's pool at all (the §5.2 set-aside offer)?
  // Only free practice: daily draws from every preset at once and has nothing
  // left to pass (§5.3).
  movesUnlockProgress: boolean
  // May the ✔ pill announce a chord reaching the pass bar (§7.3)?
  announcesLearned: boolean
  // May it announce a combo climbing a grade (§7.3)?
  announcesGradeUp: boolean
  // May it announce a selected chord reaching the loop's bar (§5.4)?
  announcesRehearsed: boolean
  // Does the mode offer "worst chords only" (§5/§7)?
  supportsWorstOnly: boolean
  // Does the mode run the learn loop (§5.4): a chosen chord set, graded on the
  // session's own reps, that ends the session once it is rehearsed?
  hasLearnLoop: boolean
  // Is the mode clock-paced (§6.5)? Read where presentation turns on it — the
  // Stage's counters, the unlock toast — never to pick an engine.
  clockPaced: boolean
}

export const MODE_POLICY: Record<SessionMode, ModePolicy> = {
  learn: {
    length: 'none',
    statsSource: 'session',
    gatesOnReady: false,
    streaks: false,
    graded: false,
    revealsAnswer: true,
    movesUnlockProgress: false,
    announcesLearned: false,
    announcesGradeUp: false,
    announcesRehearsed: true,
    supportsWorstOnly: false,
    hasLearnLoop: true,
    clockPaced: false,
  },
  daily: {
    length: 'dailyCap',
    statsSource: 'persisted',
    gatesOnReady: true,
    streaks: true,
    graded: true,
    revealsAnswer: false,
    movesUnlockProgress: false,
    announcesLearned: false,
    announcesGradeUp: true,
    announcesRehearsed: false,
    supportsWorstOnly: false,
    hasLearnLoop: false,
    clockPaced: false,
  },
  free: {
    length: 'drafted',
    statsSource: 'persisted',
    gatesOnReady: true,
    streaks: true,
    graded: true,
    revealsAnswer: false,
    movesUnlockProgress: true,
    announcesLearned: true,
    announcesGradeUp: true,
    announcesRehearsed: false,
    supportsWorstOnly: true,
    hasLearnLoop: false,
    clockPaced: false,
  },
  song: {
    length: 'none',
    statsSource: null,
    gatesOnReady: false,
    streaks: false,
    graded: false,
    revealsAnswer: false,
    movesUnlockProgress: false,
    announcesLearned: false,
    announcesGradeUp: false,
    announcesRehearsed: false,
    supportsWorstOnly: false,
    hasLearnLoop: false,
    clockPaced: true,
  },
}

// Session length (§7.2) is a count of **prompts** or of **active minutes** —
// the same minutes the daily goal measures (§7.6), so a session that is only
// half played out doesn't run out while nobody is at the keyboard. `null` is
// unlimited (∞) either way. Session-only (resets on reload), applies to Learn
// and free practice; Song ignores it (it runs until ended) and daily practice
// takes its cap from the persisted setting instead (§5.3).
export type SessionLengthUnit = 'prompts' | 'minutes'

export interface SessionLength {
  unit: SessionLengthUnit
  value: number | null
}

export const SESSION_PROMPT_LENGTHS: readonly number[] = [10, 20, 40]
export const SESSION_MINUTE_LENGTHS: readonly number[] = [5, 10, 15]

export const DEFAULT_SESSION_LENGTH: SessionLength = {
  unit: 'prompts',
  value: 20,
}

export function sanitizeSessionLength(value: unknown): SessionLength {
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_SESSION_LENGTH
  }
  const raw = value as { unit?: unknown; value?: unknown }
  const unit: SessionLengthUnit = raw.unit === 'minutes' ? 'minutes' : 'prompts'
  if (raw.value === null) return { unit, value: null } // ∞
  if (
    typeof raw.value !== 'number' ||
    !Number.isFinite(raw.value) ||
    raw.value <= 0
  ) {
    return { unit, value: DEFAULT_SESSION_LENGTH.value }
  }
  return { unit, value: Math.round(raw.value) }
}

// Has a session reached its length? Asked between prompts, never mid-attempt
// (§7.2), so a timed session always finishes the rep on screen.
export function sessionLengthReached(
  length: SessionLength,
  done: number,
  activeMs: number,
): boolean {
  if (length.value === null) return false
  return length.unit === 'prompts'
    ? done >= length.value
    : activeMs >= length.value * 60_000
}

// A length that never runs out: what the modes ending on something other than
// a length (§7.2) resolve to, so the length check can be asked unconditionally.
export const UNLIMITED_LENGTH: SessionLength = { unit: 'prompts', value: null }

// What actually ends a session (§7.2), for a mode and the length drafted for
// it: daily practice runs to its persisted cap in active minutes (§5.3), Learn
// to its chord set (§5.4) and Song to the End button, so only free practice
// takes the drafted length. Shared by the store's between-prompts check and the
// Stage's progress readout, which would otherwise each carry the rule.
export function effectiveLength(
  mode: SessionMode,
  drafted: SessionLength,
  dailyCapMinutes: number,
): SessionLength {
  switch (MODE_POLICY[mode].length) {
    case 'dailyCap':
      return { unit: 'minutes', value: dailyCapMinutes }
    case 'none':
      return UNLIMITED_LENGTH
    case 'drafted':
      return drafted
  }
}

// How long a first-try streak must run before the ✔ flash mentions it (§7.3)
// — below this it's noise, above it it's an achievement worth calling out.
export const FIRST_TRY_STREAK_DISPLAY_MIN = 10

// One recorded prompt in a session (§7.4): a self-paced Practice prompt, or a
// Song bar. Learn prompts never appear. The label is captured at
// completion time so the report doesn't need the preset's spelling context
// later. `timeToCorrectMs` is null for Song bars — a clock-paced bar has no
// "prompt shown → correct" span (§6.5), same convention as the per-combo
// stat records.
export interface SessionEvent {
  key: string
  label: string
  outcome: PromptOutcome
  timeToCorrectMs: number | null
}

// The §7 end-of-session summary: prompts played, first-try successes and the
// session's time figures, all scoped to the summarized session rather than the
// lifetime records. The Report (§7.4) builds on this via practice/report.ts.
export interface SessionSummary {
  prompts: number
  firstTrySuccesses: number
  // Sum / mean over prompts that carry a time sample (Song bars excluded).
  totalTimeToCorrectMs: number
  avgTimeToCorrectMs: number | null
}

export function summarizeSession(
  events: readonly SessionEvent[],
): SessionSummary {
  let firstTrySuccesses = 0
  let totalTimeToCorrectMs = 0
  let timedCount = 0
  for (const event of events) {
    if (event.timeToCorrectMs !== null) {
      totalTimeToCorrectMs += event.timeToCorrectMs
      timedCount += 1
    }
    firstTrySuccesses += event.outcome === 'first-try' ? 1 : 0
  }

  return {
    prompts: events.length,
    firstTrySuccesses,
    totalTimeToCorrectMs,
    avgTimeToCorrectMs:
      timedCount > 0 ? totalTimeToCorrectMs / timedCount : null,
  }
}
