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

// The prompt area (DESIGN.md §7): the chord NAME is primary, large and
// readable from a distance. The voicing being drilled appears as a separate
// label (omitted for the `any` rule) — never folded into the name.
export function PromptCard() {
  const prompt = usePractice((s) => s.prompt)
  const phase = usePractice((s) => s.phase)
  const reactionMs = usePractice((s) => s.reactionMs)
  const hint = usePractice((s) => s.hint)
  const missedRecently = usePractice((s) => s.missedRecently)
  const mode = usePractice((s) => s.mode)
  const skip = usePractice((s) => s.skip)
  const staffEnabled = useSettings((s) => s.settings.staffEnabled)
  const chordNameSize = useSettings((s) => s.settings.chordNameSize)

  if (!prompt) return null

  // The staff (§3.4) scopes to Learn mode — the example is the answer
  // display there — and joins the miss-3 reveal in Practice, which §6.4
  // highlights on the staff whenever it's shown.
  const showStaff =
    staffEnabled && (mode === 'learn' || hint?.kind === 'reveal')

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
      {/* Subtle §5 weighting indicator; fixed height so it never shifts the
          layout between weighted and fresh prompts. */}
      <p className="min-h-5 text-sm font-medium text-amber-400">
        {missedRecently !== null &&
          `🔥 Practicing: missed ${missedRecently}× recently`}
      </p>
      {/* Grand staff (§7 sketch: between indicator and feedback). The
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
          <StaffView chord={prompt.chord} notes={prompt.example} />
        </Suspense>
      )}
      {/* Fixed-height feedback line so ✔/✘ never shift the layout. Feedback
          always pairs color with an icon (§6.4); the hint stays visible
          through the retry, and misses are visual-only (§9). */}
      <p className="min-h-8 text-2xl font-semibold" role="status">
        {phase === 'advancing' && reactionMs !== null ? (
          <span className="text-emerald-400">
            ✔ Correct! ({(reactionMs / 1000).toFixed(1)}s)
          </span>
        ) : hint !== null ? (
          <span className="text-rose-400">✘ {hintText(hint)}</span>
        ) : null}
      </p>
      {/* Skip advances without counting against stats or weighting (§6.2);
          the session-timer countdown rides the same row (§7 sketch). */}
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
    </section>
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
