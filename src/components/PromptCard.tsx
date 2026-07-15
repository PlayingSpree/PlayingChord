import { usePractice } from '../store/practiceStore'

// The prompt area (DESIGN.md §7): the chord NAME is primary, large and
// readable from a distance. The voicing being drilled appears as a separate
// label (omitted for the `any` rule) — never folded into the name.
export function PromptCard() {
  const prompt = usePractice((s) => s.prompt)
  const phase = usePractice((s) => s.phase)
  const reactionMs = usePractice((s) => s.reactionMs)

  if (!prompt) return null

  return (
    <section className="flex flex-col items-center gap-4 text-center">
      <h2 className="text-7xl font-bold tracking-tight sm:text-8xl">
        {prompt.displayName}
      </h2>
      {prompt.voicing.id !== 'any' && (
        <p className="text-xl text-slate-400">{prompt.voicing.name}</p>
      )}
      {/* Fixed-height feedback line so the ✔ flash never shifts the layout. */}
      <p
        className="min-h-8 text-2xl font-semibold text-emerald-400"
        role="status"
      >
        {phase === 'advancing' && reactionMs !== null && (
          <>✔ Correct! ({(reactionMs / 1000).toFixed(1)}s)</>
        )}
      </p>
    </section>
  )
}
