// One run of a session (DESIGN.md §7.2): everything a session accumulates
// about itself between start and Report. Pure TS — the tallies here are the
// session's own, so a fresh run is a construction rather than a list of
// variables somebody has to remember to clear.
//
// What is *not* here, deliberately. Buffered active time is not session-scoped:
// a partial flush survives into the next session, so zeroing it with a run
// would throw away minutes the player earned (§7.6). The learn loop's grading
// stats aren't here either — they are read against the active preset's
// expansion (§5.4), which lives in the store layer. And whether a session is
// live is the store's business: these tallies deliberately outlive it, because
// the Report is assembled after practice has already halted.

import {
  buildSessionReport,
  type DailyStatsForBaseline,
  type ReportChord,
  type ReportGoal,
  type ReportUnlock,
  type SessionReport,
} from './report'
import {
  MODE_POLICY,
  summarizeSession,
  type SessionEvent,
  type SessionMode,
} from './session'
import type { ComboGrade } from './stats'

// Live session tallies (§7). Each fresh session zeroes these. Learn-mode
// prompts never count toward accuracy (§7); time-to-correct includes retries.
// Song bars count as prompts with no time sample (§6.5).
export interface SessionStats {
  prompts: number
  firstTrySuccesses: number
  totalTimeToCorrectMs: number
}

// Everything the §7.4 Report needs that the session itself doesn't hold: the
// persisted history it is measured against, and the figures derived from the
// pool it was drawn from. The caller assembles these; the run merges its own
// tallies in.
export interface SessionRunContext {
  mode: SessionMode
  // Prompts advanced past this session — correct *and* Learn — where the run's
  // own event log holds only the recorded ones (§7.2).
  promptsPlayed: number
  records: Readonly<Record<string, DailyStatsForBaseline>>
  todayKey: string
  lifetime: { prompts: number; activeMinutes: number }
  goal: ReportGoal
  // The session's chords folded through the pool (labels, grades, whether each
  // can be benched) and the preset's already-benched ones, for the §5.2 offer.
  chords: readonly ReportChord[]
  setAside: readonly { chordKey: string; label: string }[]
  // The preset's unlock standing *after* this session, for the unlock banner —
  // read only when the session actually opened something.
  unlockedTotals: { unlocked: number; passed: number; total: number }
  // Selected chords the learn loop didn't bring up (§5.4); read only in a mode
  // that runs the loop.
  learnRemaining: readonly string[]
}

export class SessionRun {
  #events: SessionEvent[] = []
  #passedLabels: string[] = []
  #unlockedLabels: string[] = []
  #rehearsedLabels: string[] = []
  #activeMs = 0
  // `${comboKey}:${grade}` for every climb already announced (§7.3): a grade
  // rides a moving window, so a combo hovering on a cut point re-crosses it
  // every few reps, and B → A → B → A would otherwise announce the same A over
  // and over. A fresh run hears each climb again, which is the point.
  #announcedGradeUps = new Set<string>()

  // A recorded prompt (§7.4): a self-paced Practice rep, or a Song bar. Learn
  // reps never reach here — they are stats-neutral (§5) and log nothing.
  logEvent(event: SessionEvent): void {
    this.#events.push(event)
  }

  // A chord that reached the pass bar this session (§5.1), in the order they
  // got there. Deduped: a chord passes once, however many reps follow it.
  notePassed(label: string): void {
    if (!this.#passedLabels.includes(label)) this.#passedLabels.push(label)
  }

  // The chords a batch just opened (§5.1) — a batch at a time, since that is
  // how the frontier moves.
  noteUnlocked(labels: readonly string[]): void {
    for (const label of labels) {
      if (!this.#unlockedLabels.includes(label))
        this.#unlockedLabels.push(label)
    }
  }

  // A selected chord brought up to the learn loop's bar (§5.4).
  noteRehearsed(label: string): void {
    if (!this.#rehearsedLabels.includes(label)) {
      this.#rehearsedLabels.push(label)
    }
  }

  // This session's share of active time (§7.2): what a timed length runs
  // against and what the Report reports as its increment.
  addActiveMs(ms: number): void {
    this.#activeMs += ms
  }

  // Is this combo climbing to this grade news (§7.3)? Answering also records
  // it, so the second ask in a session is no.
  announceGradeUp(comboKey: string, to: ComboGrade): boolean {
    const announced = `${comboKey}:${to}`
    if (this.#announcedGradeUps.has(announced)) return false
    this.#announcedGradeUps.add(announced)
    return true
  }

  get activeMs(): number {
    return this.#activeMs
  }

  // The recorded prompts, for callers that fold them by something the run
  // doesn't know about — the Report's per-chord breakdown needs the pool's
  // spelling and grades (§7.4), so it folds this itself.
  get events(): readonly SessionEvent[] {
    return this.#events
  }

  // The live tallies the Stage reads. Deliberately not summarizeSession's
  // shape: the mean time is a Report figure, derived there from the same log.
  stats(): SessionStats {
    const summary = summarizeSession(this.#events)
    return {
      prompts: summary.prompts,
      firstTrySuccesses: summary.firstTrySuccesses,
      totalTimeToCorrectMs: summary.totalTimeToCorrectMs,
    }
  }

  // The §7.4 Report: this run's tallies, shaped into the report input and
  // handed to the derivations (grade, trailing baseline, still-shaky list).
  // Called only when at least one prompt played.
  report(ctx: SessionRunContext): SessionReport {
    const unlocked: ReportUnlock | null =
      this.#unlockedLabels.length > 0
        ? { labels: [...this.#unlockedLabels], ...ctx.unlockedTotals }
        : null

    return buildSessionReport({
      mode: ctx.mode,
      promptsPlayed: ctx.promptsPlayed,
      events: this.#events,
      records: ctx.records,
      todayKey: ctx.todayKey,
      lifetime: ctx.lifetime,
      increment: {
        prompts: this.#events.length,
        activeMinutes: this.#activeMs / 60_000,
      },
      passedLabels: [...this.#passedLabels],
      unlocked,
      learn: MODE_POLICY[ctx.mode].hasLearnLoop
        ? {
            rehearsed: [...this.#rehearsedLabels],
            remaining: [...ctx.learnRemaining],
          }
        : null,
      chords: ctx.chords,
      setAside: ctx.setAside,
      goal: ctx.goal,
    })
  }
}
