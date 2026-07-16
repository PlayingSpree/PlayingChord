import { usePractice } from '../store/practiceStore'
import type { SummaryChordEntry } from '../practice'

// End-of-session summary (§7): shown when the session timer runs out.
// Practice is frozen behind it; dismissing resumes endless practice as a
// fresh session.
export function SessionSummaryModal() {
  const summary = usePractice((s) => s.summary)
  const dismiss = usePractice((s) => s.dismissSummary)

  if (summary === null) return null

  const accuracy =
    summary.prompts > 0
      ? `${Math.round((100 * summary.firstTrySuccesses) / summary.prompts)}%`
      : '—'
  const avgTime =
    summary.prompts > 0
      ? `${(summary.totalTimeToCorrectMs / summary.prompts / 1000).toFixed(1)}s`
      : '—'

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-950/80 px-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Session summary"
        className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
      >
        <h2 className="text-xl font-bold">⏱ Time&#39;s up!</h2>
        <div className="mt-4 flex gap-8">
          <SummaryStat label="Prompts" value={String(summary.prompts)} />
          <SummaryStat label="First-try" value={accuracy} />
          <SummaryStat label="Avg time" value={avgTime} />
        </div>
        <div className="mt-5 grid grid-cols-2 gap-6 text-sm">
          <ChordList
            title="Slowest"
            entries={summary.slowest}
            metric={(e) => `${(e.avgTimeToCorrectMs / 1000).toFixed(1)}s`}
          />
          <ChordList
            title="Worst"
            entries={summary.worst}
            metric={(e) => `${Math.round(e.accuracy * 100)}%`}
          />
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="mt-6 w-full rounded-md bg-emerald-600 px-4 py-2 font-medium text-white transition-colors hover:bg-emerald-500"
        >
          Continue practicing
        </button>
      </section>
    </div>
  )
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-2xl font-semibold text-slate-100">{value}</div>
    </div>
  )
}

function ChordList({
  title,
  entries,
  metric,
}: {
  title: string
  entries: SummaryChordEntry[]
  metric: (entry: SummaryChordEntry) => string
}) {
  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {title}
      </h3>
      {entries.length === 0 ? (
        <p className="mt-1.5 text-slate-500">—</p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1">
          {entries.map((entry) => (
            <li key={entry.key} className="flex justify-between gap-2">
              <span className="text-slate-200">{entry.label}</span>
              <span className="text-slate-400">{metric(entry)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
