import { describe, expect, it } from 'vitest'
import { ActiveTimeTracker } from './activeTime'

describe('ActiveTimeTracker (§7 active-minutes rule)', () => {
  it('credits nothing for the first event', () => {
    const tracker = new ActiveTimeTracker(30_000)
    expect(tracker.touch(1_000_000)).toBe(0)
  })

  it('credits the gap between events within the idle window', () => {
    const tracker = new ActiveTimeTracker(30_000)
    tracker.touch(0)
    expect(tracker.touch(5_000)).toBe(5_000)
    expect(tracker.touch(35_000)).toBe(30_000) // exactly the window still counts
  })

  it('credits nothing across a gap longer than the window', () => {
    const tracker = new ActiveTimeTracker(30_000)
    tracker.touch(0)
    expect(tracker.touch(30_001)).toBe(0)
    // …but the late event starts a new segment.
    expect(tracker.touch(31_001)).toBe(1_000)
  })

  it('ignores clock skew (time going backwards)', () => {
    const tracker = new ActiveTimeTracker(30_000)
    tracker.touch(10_000)
    expect(tracker.touch(5_000)).toBe(0)
    expect(tracker.touch(6_000)).toBe(1_000)
  })
})
