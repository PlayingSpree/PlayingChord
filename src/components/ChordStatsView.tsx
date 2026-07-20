import { useMemo, useState } from 'react'
import { appStorage } from '../storage'
import {
  allComboRows,
  comboLabel,
  comboMetrics,
  RECENT_OUTCOME_WINDOW,
  RECENT_TIME_WINDOW,
  type ComboMetrics,
} from '../practice'
import { voicingLibrary } from '../theory'
import { useLibrary } from '../store/libraryStore'

// The §7 chord stats drill-down (reached from History): every combo ever
// practiced, not just the top-3 worst/most-improved lists — sortable so any
// axis (accuracy, speed, volume) can lead. Lifetime and recent figures sit
// side by side per metric — "recent" windows differently per metric
// (comboMetrics): accuracy uses the same window as weighting, time uses its
// own wider one, since more time samples are kept per combo.

interface Row {
  key: string
  label: string
  metrics: ComboMetrics
}

type ColumnId =
  | 'grade'
  | 'attempts'
  | 'lifetimeAccuracy'
  | 'recentAccuracy'
  | 'lifetimeAvg'
  | 'recentAvg'

interface ColumnDef {
  id: ColumnId
  label: string
  defaultDir: 'asc' | 'desc'
  value: (row: Row) => number | null
  format: (row: Row) => string
}

const formatAccuracy = (v: number | null) =>
  v === null ? '—' : `${Math.round(v * 100)}%`
const formatTime = (v: number | null) =>
  v === null ? '—' : `${(v / 1000).toFixed(1)}s`

// "Worst/slowest/most-evidence first" is the default direction per column —
// the same actionable-first stance as the History worst-chords list.
const COLUMNS: ColumnDef[] = [
  {
    id: 'grade',
    label: 'Grade',
    defaultDir: 'asc',
    value: (row) => row.metrics.score,
    format: (row) => row.metrics.grade,
  },
  {
    id: 'attempts',
    label: 'Attempts',
    defaultDir: 'desc',
    value: (row) => row.metrics.attempts,
    format: (row) => String(row.metrics.attempts),
  },
  {
    id: 'lifetimeAccuracy',
    label: 'Lifetime accuracy',
    defaultDir: 'asc',
    value: (row) => row.metrics.lifetimeAccuracy,
    format: (row) => formatAccuracy(row.metrics.lifetimeAccuracy),
  },
  {
    id: 'recentAccuracy',
    label: 'Recent accuracy',
    defaultDir: 'asc',
    value: (row) => row.metrics.recentAccuracy,
    format: (row) => formatAccuracy(row.metrics.recentAccuracy),
  },
  {
    id: 'lifetimeAvg',
    label: 'Lifetime avg time',
    defaultDir: 'desc',
    value: (row) => row.metrics.lifetimeAvgTimeToCorrectMs,
    format: (row) => formatTime(row.metrics.lifetimeAvgTimeToCorrectMs),
  },
  {
    id: 'recentAvg',
    label: 'Recent avg time',
    defaultDir: 'desc',
    value: (row) => row.metrics.recentAvgTimeToCorrectMs,
    format: (row) => formatTime(row.metrics.recentAvgTimeToCorrectMs),
  },
]

// Rows with no data on the sorted column (Song-mode-only combos have no
// time-to-correct average) sort last regardless of direction, rather than
// flip-flopping to the top on descending sorts.
function compareRows(
  a: Row,
  b: Row,
  column: ColumnDef,
  dir: 'asc' | 'desc',
): number {
  const av = column.value(a)
  const bv = column.value(b)
  if (av === null && bv === null) return a.label.localeCompare(b.label)
  if (av === null) return 1
  if (bv === null) return -1
  const diff = dir === 'asc' ? av - bv : bv - av
  return diff !== 0 ? diff : a.label.localeCompare(b.label)
}

export function ChordStatsView({ onBack }: { onBack: () => void }) {
  const customRules = useLibrary((s) => s.customRules)
  const [sort, setSort] = useState<{ column: ColumnId; dir: 'asc' | 'desc' }>({
    column: 'recentAccuracy',
    dir: 'asc',
  })

  const rows = useMemo(() => {
    const library = voicingLibrary(customRules)
    const { comboStats } = appStorage.state
    return allComboRows(comboStats, library).map((row): Row => ({
      key: row.key,
      label: comboLabel(row.combo, undefined, library),
      metrics: comboMetrics(row.record),
    }))
  }, [customRules])

  const column = COLUMNS.find((c) => c.id === sort.column) ?? COLUMNS[0]!
  const sorted = useMemo(
    () => [...rows].sort((a, b) => compareRows(a, b, column, sort.dir)),
    [rows, column, sort.dir],
  )

  const onSortClick = (id: ColumnId) => {
    setSort((prev) =>
      prev.column === id
        ? { column: id, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : {
            column: id,
            dir: (COLUMNS.find((c) => c.id === id) ?? COLUMNS[0]!).defaultDir,
          },
    )
  }

  return (
    <main className="flex min-h-screen flex-col bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between gap-4 border-b border-slate-800 px-6 py-3">
        <h1 className="text-lg font-bold tracking-tight">
          PlayingChord{' '}
          <span className="font-normal text-slate-400">— Chord stats</span>
        </h1>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
        >
          ← History
        </button>
      </header>

      {rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-slate-400">
          <p>
            No practiced chords yet.
            <br />
            Play a few prompts and this page fills up.
          </p>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-4xl px-6 py-8">
          <p className="mb-4 text-sm text-slate-400">
            Every combo practiced so far, lifetime across all presets. Recent
            accuracy is the last {RECENT_OUTCOME_WINDOW} attempts (the same
            window that drives weighting); recent avg time is the last{' '}
            {RECENT_TIME_WINDOW}. Grade (A–F) folds recent accuracy and speed
            into one figure, the same one that drives weighting.
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-3 py-2 font-medium">Chord</th>
                  {COLUMNS.map((col) => (
                    <th key={col.id} className="px-3 py-2 font-medium">
                      <button
                        type="button"
                        onClick={() => onSortClick(col.id)}
                        className={`flex items-center gap-1 transition-colors hover:text-slate-200 ${
                          sort.column === col.id ? 'text-slate-200' : ''
                        }`}
                      >
                        {col.label}
                        {sort.column === col.id && (
                          <span aria-hidden>
                            {sort.dir === 'asc' ? '▲' : '▼'}
                          </span>
                        )}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((row) => (
                  <tr
                    key={row.key}
                    className="border-b border-slate-800/60 last:border-0"
                  >
                    <td className="px-3 py-2 text-slate-200">{row.label}</td>
                    {COLUMNS.map((col) => (
                      <td key={col.id} className="px-3 py-2 text-slate-300">
                        {col.format(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  )
}
