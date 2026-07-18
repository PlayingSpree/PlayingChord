import { lazy, Suspense, useEffect, useState } from 'react'
import { usePractice } from '../store/practiceStore'
import { useSettings } from '../store/settingsStore'
import type { ChordNameSize, Hint } from '../practice'

// VexFlow + music font are a heavy chunk; staff-off users (a first-class
// way to run the app, §3.4) never download it.
const StaffView = lazy(() => import('./StaffView'))

// Tailwind classes per chord-name size setting (§7); 'lg' matches the
// original fixed size.
const CHORD_NAME_SIZE_CLASSES: Record<ChordNameSize, string> = {
  sm: 'text-5xl sm:text-6xl',
  md: 'text-6xl sm:text-7xl',
  lg: 'text-7xl sm:text-8xl',
  xl: 'text-8xl sm:text-9xl',
}

// The chip row (upcoming preview / song progression) tracks the same setting
// so it stays readable from whatever distance the name is sized for. Set on
// the row container; chips inherit.
const CHIP_SIZE_CLASSES: Record<ChordNameSize, string> = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-xl',
  xl: 'text-2xl',
}

// The prompt area (DESIGN.md §7): the chord NAME is primary, large and
// readable from a distance. The voicing being drilled appears as a separate
// label (omitted for the `any` rule) — never folded into the name.
export function PromptCard() {
  const prompt = usePractice((s) => s.prompt)
  const phase = usePractice((s) => s.phase)
  const reactionMs = usePractice((s) => s.reactionMs)
  const hint = usePractice((s) => s.hint)
  const upcoming = usePractice((s) => s.upcoming)
  const song = usePractice((s) => s.song)
  const skip = usePractice((s) => s.skip)
  const staffEnabled = useSettings((s) => s.settings.staffEnabled)
  const staffKeyEnabled = useSettings((s) => s.settings.staffKeyEnabled)
  const chordNameSize = useSettings((s) => s.settings.chordNameSize)

  if (!prompt) return null

  // The staff (§3.4) is purely setting-controlled: whenever staffEnabled
  // is on, it's shown from the first prompt, in both Learn and Practice.
  const showStaff = staffEnabled
  const keySignature = staffKeyEnabled ? prompt.chord.root : null

  return (
    <section className="flex flex-col items-center gap-4 text-center">
      <h2
        className={`font-bold tracking-tight ${CHORD_NAME_SIZE_CLASSES[chordNameSize]}`}
      >
        {prompt.displayName}
      </h2>
      {prompt.voicing.id !== 'any' && (
        <p className="text-xl text-slate-400">{prompt.voicing.name}</p>
      )}
      {/* Song mode (§6.5): the chip row is the progression display — the
          whole progression with Roman numerals, the current chip pulsing on
          the beat, hit/miss stamped as each bar completes, laid out as a
          left-to-right row (it reads in time). Otherwise it's the §5/§7
          upcoming preview: the next combos to be dealt, stacked top to
          bottom with the next one on top. Min-height so an empty row never
          shifts the layout. */}
      <div
        className={`flex min-h-10 items-center justify-center gap-2 ${
          song !== null ? 'flex-wrap' : 'flex-col'
        } ${CHIP_SIZE_CLASSES[chordNameSize]}`}
      >
        {song !== null ? (
          <SongProgressionChips />
        ) : (
          upcoming.map((u, i) => (
            <span
              key={`${i}-${u.key}`}
              className="rounded-full bg-slate-800 px-3 py-1 text-slate-400"
            >
              {u.label}
            </span>
          ))
        )}
      </div>
      {/* Grand staff (§7 sketch: between the name and feedback). The
          fallback mirrors the card so the chunk/font load never jumps the
          layout. */}
      {showStaff && (
        <Suspense
          fallback={
            <div
              aria-hidden="true"
              className="h-[240px] w-[320px] rounded-lg bg-slate-100 shadow-inner"
            />
          }
        >
          <StaffView
            chord={prompt.chord}
            notes={prompt.example}
            keySignature={keySignature}
          />
        </Suspense>
      )}
      {/* Fixed-height feedback line so ✔/✘ never shift the layout. Feedback
          always pairs color with an icon (§6.4); the hint stays visible
          through the retry, and misses are visual-only (§9). In Song mode
          the count-in bar carries the beat count or the previous phrase's
          per-chord summary (§6.5). */}
      <p className="min-h-8 text-2xl font-semibold" role="status">
        {song !== null && song.countingIn ? (
          <SongCountIn />
        ) : phase === 'advancing' && reactionMs !== null ? (
          <span className="text-emerald-400">
            ✔ Correct! ({(reactionMs / 1000).toFixed(1)}s)
          </span>
        ) : hint !== null ? (
          <span className="text-rose-400">✘ {hintText(hint)}</span>
        ) : null}
      </p>
      {/* Skip advances without counting against stats or weighting (§6.2);
          the session-timer countdown rides the same row (§7 sketch). Song
          is clock-paced — no skipping, no timer (§6.5). */}
      {song === null && (
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={skip}
            className="rounded-md border border-slate-700 px-4 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
          >
            Skip →
          </button>
          <Countdown />
        </div>
      )}
    </section>
  )
}

// The §6.5 progression display: label over Roman numeral per chip (the
// numeral only exists for a diatonic preset); the current chip pulses once
// per beat (remounted via the beat counter) and each chip is stamped ✓/✗
// as its bar completes within the current loop.
function SongProgressionChips() {
  const song = usePractice((s) => s.song)
  const songChords = usePractice((s) => s.songChords)
  if (song === null) return null

  return songChords.map((chip, i) => {
    const current = !song.countingIn && i === song.barIndex
    const result = song.results[i]
    return (
      <span
        key={`${i}-${chip.key}`}
        className={`flex flex-col items-center rounded-lg px-3 py-1 leading-tight ${
          current
            ? 'bg-slate-700 text-slate-100 ring-1 ring-sky-400'
            : 'bg-slate-800 text-slate-400'
        }`}
      >
        <span
          key={current ? song.beat : -1}
          className={current ? 'animate-[beat-pulse_180ms_ease-out]' : ''}
        >
          {result === true && <span className="text-emerald-400">✓ </span>}
          {result === false && <span className="text-rose-400">✗ </span>}
          {chip.label}
        </span>
        {chip.roman !== '' && (
          <span className="text-[0.7em] text-slate-500">{chip.roman}</span>
        )}
      </span>
    )
  })
}

// The count-in line (§6.5): beat count, or the previous phrase's per-chord
// hit tally when one just completed.
function SongCountIn() {
  const song = usePractice((s) => s.song)
  const songSummary = usePractice((s) => s.songSummary)
  if (song === null || !song.countingIn) return null

  if (songSummary === null) {
    return (
      <span className="text-base font-medium text-slate-300">
        Count-in… {song.beatInBar + 1}
      </span>
    )
  }
  return (
    <span className="flex flex-wrap items-center justify-center gap-x-3 text-base font-medium">
      <span className="text-slate-400">Phrase:</span>
      {songSummary.map((entry, i) => (
        <span
          key={i}
          className={
            entry.hits === entry.loops
              ? 'text-emerald-400'
              : entry.hits === 0
                ? 'text-rose-400'
                : 'text-amber-300'
          }
        >
          {entry.label} {entry.hits}/{entry.loops}
        </span>
      ))}
    </span>
  )
}

// Live countdown for the §7 session timer; the store owns expiry, this only
// displays the remaining time.
function Countdown() {
  const timerEndsAt = usePractice((s) => s.timerEndsAt)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (timerEndsAt === null) return
    const tick = setInterval(() => setNowMs(Date.now()), 250)
    return () => clearInterval(tick)
  }, [timerEndsAt])

  if (timerEndsAt === null) return null
  const remaining = Math.max(0, timerEndsAt - nowMs)
  const minutes = Math.floor(remaining / 60_000)
  const seconds = Math.floor((remaining % 60_000) / 1000)
  return (
    <span className="text-sm font-medium tabular-nums text-slate-300">
      ⏱ {minutes}:{String(seconds).padStart(2, '0')}
    </span>
  )
}

function hintText(hint: Hint): string {
  switch (hint.kind) {
    case 'wrong-keys':
      return 'Try again — wrong keys are marked'
    case 'constraint':
      return hint.text
    case 'reveal':
      return 'Try again — answer shown on the keyboard'
  }
}
