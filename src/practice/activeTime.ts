// Active practice time (DESIGN.md §7, the Phase 7 "active minutes" rule):
//
//   Time accrues between consecutive interaction events — held-note-set
//   changes reaching the practice store — whenever the gap between two
//   events is at most ACTIVE_IDLE_WINDOW_MS. Longer gaps contribute
//   nothing: walking away from the keyboard stops the clock at the last
//   note, and the next note starts a fresh segment.
//
// This deliberately counts any playing (Learn mode, noodling between
// prompts) — the daily goal measures time at the keyboard, not judged
// prompts (§5: Learn is stats-neutral but its active time counts).
export const ACTIVE_IDLE_WINDOW_MS = 30_000

export class ActiveTimeTracker {
  private readonly idleWindowMs: number
  private lastEventMs: number | null = null

  constructor(idleWindowMs = ACTIVE_IDLE_WINDOW_MS) {
    this.idleWindowMs = idleWindowMs
  }

  // Registers an interaction event; returns the active ms this event earned
  // (the gap since the previous event, or 0 when it broke the window).
  touch(nowMs: number): number {
    const last = this.lastEventMs
    this.lastEventMs = nowMs
    if (last === null || nowMs < last) return 0 // first event, or clock skew
    const gap = nowMs - last
    return gap <= this.idleWindowMs ? gap : 0
  }
}
