import { usePractice } from '../store/practiceStore'

// The live stats panel (DESIGN.md §7): prompts, first-try accuracy and
// average time-to-correct are session-scoped (skips excluded, retries
// included in the time); "worst" draws on the persisted per-combo records,
// so a chord missed before a reload stays listed (Milestone B).
export function StatsBar() {
  const session = usePractice((s) => s.session)
  const worstChords = usePractice((s) => s.worstChords)

  const accuracy =
    session.prompts > 0
      ? `${Math.round((100 * session.firstTrySuccesses) / session.prompts)}%`
      : '—'
  const avgTime =
    session.prompts > 0
      ? `${(session.totalTimeToCorrectMs / session.prompts / 1000).toFixed(1)}s`
      : '—'

  return (
    <section
      aria-label="Session stats"
      className="flex min-h-9 flex-wrap items-center justify-center gap-x-8 gap-y-1 border-t border-slate-800 px-6 py-2 text-sm"
    >
      <Stat label="Prompts" value={String(session.prompts)} />
      <Stat label="First-try" value={accuracy} />
      <Stat label="Avg time" value={avgTime} />
      <span className="flex items-center gap-2 text-slate-400">
        Worst
        {worstChords.length === 0 ? (
          <span className="font-semibold text-slate-200">—</span>
        ) : (
          worstChords.map((entry) => (
            <span
              key={entry.key}
              className="rounded bg-slate-800 px-2 py-0.5 font-medium text-amber-300"
            >
              {entry.label} · {Math.round(entry.accuracy * 100)}%
            </span>
          ))
        )}
      </span>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="text-slate-400">
      {label} <span className="font-semibold text-slate-200">{value}</span>
    </span>
  )
}
