import { useEffect, useState } from 'react'
import { usePractice } from '../store/practiceStore'
import type { Hint } from '../practice'

// The prompt area (DESIGN.md §7): the chord NAME is primary, large and
// readable from a distance. The voicing being drilled appears as a separate
// label (omitted for the `any` rule) — never folded into the name.
export function PromptCard() {
  const prompt = usePractice((s) => s.prompt)
  const phase = usePractice((s) => s.phase)
  const reactionMs = usePractice((s) => s.reactionMs)
  const hint = usePractice((s) => s.hint)
  const missedRecently = usePractice((s) => s.missedRecently)
  const skip = usePractice((s) => s.skip)

  if (!prompt) return null

  return (
    <section className="flex flex-col items-center gap-4 text-center">
      <h2 className="text-7xl font-bold tracking-tight sm:text-8xl">
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
