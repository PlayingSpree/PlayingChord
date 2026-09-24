import { pitchClass } from '../theory'
import { computeRunHint, REVEAL_AFTER_MISSES, type Hint } from './hints'
import type { AttemptPhase, LifecycleHost, LifecycleState } from './lifecycle'
import type { ScalePrompt } from './prompts'

// The §6.6 scale-run attempt machine: a run is a sequence of single notes,
// which §6.2's held-set judging can't express, so it gets its own machine
// reporting the same LifecycleState — the pill, stats recording, callouts
// and Report take a run exactly as they take a chord. Pure TS; the one
// timer is the §6.2 auto-advance, so tests drive it with fake timers.
//
// - 'armed': judging note-ons. There is no 'awaiting-release': only a key
//   going down is judged, so keys held over from the last prompt — or the
//   note that answered the §7.3 Ready panel — never count.
// - 'missed': ✘ shown; still judging, waiting on the expected note. Playing
//   it (or restarting) returns to 'armed'.
// - 'advancing': ✔ on the run's last note; input ignored until the host is
//   asked for the next prompt.
// There is no stall: a pause mid-run is thinking, already paid for on the
// clock.
export class RunLifecycle {
  private readonly host: LifecycleHost
  private prompt: ScalePrompt | null = null
  private held: ReadonlySet<number> = new Set()
  private shownAt = 0
  private phase: AttemptPhase = 'idle'
  private reactionMs: number | null = null
  private missCount = 0
  private hint: Hint | null = null
  // The run in the octave its first note fixed; the example until then.
  private notes: readonly number[] = []
  // Notes played correctly so far — notes[played] is the one awaited.
  private played = 0
  // Wrong keys played at the awaited position. However many, they are one
  // miss: a fumble is one mistake, and counting each key would race the
  // hint to its reveal on a single bad spot (§6.6).
  private wrong: number[] = []
  private advanceTimer: ReturnType<typeof setTimeout> | null = null

  constructor(host: LifecycleHost) {
    this.host = host
  }

  get state(): LifecycleState {
    return {
      phase: this.phase,
      reactionMs: this.reactionMs,
      missCount: this.missCount,
      hint: this.hint,
      run: this.prompt ? { notes: this.notes, played: this.played } : null,
    }
  }

  promptShown(prompt: ScalePrompt): void {
    this.clearAdvance()
    this.prompt = prompt
    this.shownAt = this.host.now()
    this.missCount = 0
    this.hint = null
    this.reactionMs = null
    this.notes = prompt.example
    this.played = 0
    this.wrong = []
    this.phase = 'armed'
    this.emit()
  }

  heldChange(held: ReadonlySet<number>): void {
    // Note-ons only: releases, and keys still down, are never judged.
    const pressed = [...held]
      .filter((note) => !this.held.has(note))
      .sort((a, b) => a - b)
    this.held = held
    for (const note of pressed) {
      if (this.phase !== 'armed' && this.phase !== 'missed') return
      this.noteOn(note)
    }
  }

  // Halt without advancing — the practice flow is leaving. Held keys are
  // still tracked, so a key down now is never judged as a note-on later.
  stop(): void {
    this.clearAdvance()
    this.prompt = null
    this.phase = 'idle'
    this.reactionMs = null
    this.missCount = 0
    this.hint = null
    this.notes = []
    this.played = 0
    this.wrong = []
    this.emit()
  }

  private noteOn(note: number): void {
    const prompt = this.prompt
    if (!prompt) return
    const start = this.notes[0]
    if (this.played === 0) {
      // The first note must be the root, in any octave; it fixes where the
      // run sits.
      if (
        start === undefined ||
        pitchClass(note) !== pitchClass(prompt.scale.root)
      ) {
        this.miss(note)
        return
      }
      const shift = note - start
      this.notes = this.notes.map((n) => n + shift)
      this.progress()
      return
    }
    if (note === this.notes[this.played]) {
      this.progress()
      return
    }
    // Starting over is free (§6.6): the exact starting note, while it isn't
    // the awaited one, restarts the run — no miss, the clock still running.
    // At the end of an up-and-down run it *is* the awaited one, so it can't
    // be mistaken for this.
    if (note === start) {
      this.played = 0
      this.progress()
      return
    }
    this.miss(note)
  }

  // One more note of the run played: the last is ✔, anything before it
  // returns a miss to 'armed' and clears its marks — the reveal stays, now
  // over what's left.
  private progress(): void {
    this.played += 1
    this.wrong = []
    if (this.played >= this.notes.length) {
      this.correct()
      return
    }
    this.hint =
      this.stage() >= REVEAL_AFTER_MISSES
        ? computeRunHint(this.stage(), [], this.rest())
        : null
    this.phase = 'armed'
    this.emit()
  }

  private correct(): void {
    this.reactionMs = this.host.now() - this.shownAt
    this.hint = null // the ✔ flash replaces any hint overlay
    this.phase = 'advancing'
    this.advanceTimer = setTimeout(() => {
      this.advanceTimer = null
      this.host.onAdvance()
    }, this.host.settings().autoAdvanceMs)
    this.emit()
  }

  private miss(note: number): void {
    if (this.wrong.length === 0) this.missCount += 1
    if (!this.wrong.includes(note)) this.wrong.push(note)
    this.hint = computeRunHint(this.stage(), this.wrong, this.rest())
    this.phase = 'missed'
    this.emit()
  }

  // The §6.4 hint stage: the miss count, held below the reveal where the
  // host says the answer is already showing (Learn).
  private stage(): number {
    return (this.host.revealOnMisses?.() ?? true)
      ? this.missCount
      : Math.min(this.missCount, REVEAL_AFTER_MISSES - 1)
  }

  private rest(): number[] {
    return this.notes.slice(this.played)
  }

  private clearAdvance(): void {
    if (this.advanceTimer !== null) {
      clearTimeout(this.advanceTimer)
      this.advanceTimer = null
    }
  }

  private emit(): void {
    this.host.onState(this.state)
  }
}
