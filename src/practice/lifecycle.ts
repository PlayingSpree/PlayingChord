import { isDefinitivelyUnsatisfiable, matches } from '../theory'
import { computeHint, type Hint } from './hints'
import type { Prompt } from './prompts'
import type { PracticeSettings } from './settings'

// The §6.2 attempt lifecycle as an explicit state machine — pure TS, no
// DOM/MIDI; timers are plain setTimeout/clearTimeout so tests drive it with
// fake timers.
//
// - 'awaiting-release': prompt shown, keys still down — arms only once all
//   keys are released, so held-over notes never judge the new prompt (step 1).
// - 'armed': judged on every held-set change (step 2). Releasing all keys
//   before any judgment abandons the attempt silently (step 3).
// - 'missed': ✘ latched, hint shown per stage (§6.4); input is ignored until
//   all keys are released, which starts a new attempt on the same prompt.
// - 'advancing': ✔ shown; input is ignored until the auto-advance timer asks
//   the host for the next prompt.
export type AttemptPhase =
  'idle' | 'awaiting-release' | 'armed' | 'missed' | 'advancing'

export interface LifecycleState {
  phase: AttemptPhase
  // Prompt shown → correct match, retries included (§7).
  reactionMs: number | null
  // Misses on the current prompt; drives the hint stage (§6.4) and, from
  // Phase 6, first-try accuracy.
  missCount: number
  hint: Hint | null
}

export interface LifecycleHost {
  // Read at every judgment so settings changes apply immediately.
  settings(): PracticeSettings
  now(): number
  onState(state: LifecycleState): void
  // The machine wants the next prompt (auto-advance elapsed, or skip); the
  // host responds by calling promptShown().
  onAdvance(): void
}

export class AttemptLifecycle {
  private readonly host: LifecycleHost
  private prompt: Prompt | null = null
  private held: ReadonlySet<number> = new Set()
  private shownAt = 0
  private phase: AttemptPhase = 'idle'
  private reactionMs: number | null = null
  private missCount = 0
  private hint: Hint | null = null
  private stallTimer: ReturnType<typeof setTimeout> | null = null
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
    }
  }

  promptShown(prompt: Prompt): void {
    this.clearStall()
    this.clearAdvance()
    this.prompt = prompt
    this.shownAt = this.host.now()
    this.missCount = 0
    this.hint = null
    this.reactionMs = null
    // §6.2 step 1: arm only once all keys are released.
    this.phase = this.held.size === 0 ? 'armed' : 'awaiting-release'
    this.emit()
  }

  heldChange(held: ReadonlySet<number>): void {
    this.held = held
    switch (this.phase) {
      case 'idle':
      case 'advancing': // notes during the advance window are ignored (step 2)
        return
      case 'awaiting-release':
      case 'missed': // releasing all keys starts a new attempt (step 3)
        if (held.size === 0) {
          this.phase = 'armed'
          this.emit()
        }
        return
      case 'armed':
        this.judge(held)
        return
    }
  }

  // §6.2 step 4: advance without judging. Nothing is recorded, so skips stay
  // out of accuracy stats and miss weighting when Phase 6 adds them.
  skip(): void {
    if (this.phase === 'idle' || this.phase === 'advancing') return
    this.clearStall()
    this.host.onAdvance()
  }

  private judge(held: ReadonlySet<number>): void {
    const prompt = this.prompt
    if (!prompt) return
    this.clearStall() // any change restarts the stall clock
    if (held.size === 0) return // silent abandon: no judgment, no hint stage
    const settings = this.host.settings()

    if (matches(held, prompt.chord, prompt.voicing, settings)) {
      this.reactionMs = this.host.now() - this.shownAt
      this.hint = null // the ✔ flash replaces any hint overlay
      this.phase = 'advancing'
      this.advanceTimer = setTimeout(() => {
        this.advanceTimer = null
        this.host.onAdvance()
      }, settings.autoAdvanceMs)
      this.emit()
      return
    }

    if (
      isDefinitivelyUnsatisfiable(held, prompt.chord, prompt.voicing, settings)
    ) {
      this.miss(settings)
      return
    }

    // Stall (§6.2): enough keys for the chord, wrong, and unchanged for the
    // judgment delay. Smaller sets are still being built up — never stalled.
    if (held.size >= prompt.chord.type.intervals.length) {
      this.stallTimer = setTimeout(() => {
        this.stallTimer = null
        if (this.phase === 'armed') this.miss(this.host.settings())
      }, settings.judgmentDelayMs)
    }
  }

  private miss(settings: PracticeSettings): void {
    if (!this.prompt) return
    this.missCount += 1
    this.hint = computeHint(this.missCount, this.held, this.prompt, settings)
    this.phase = 'missed'
    this.emit()
  }

  private clearStall(): void {
    if (this.stallTimer !== null) {
      clearTimeout(this.stallTimer)
      this.stallTimer = null
    }
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
