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
import { Card, RaisedButton } from './ui'
import { cx } from './cx'

// The §7.5 chord stats drill-down (reached from Progress): every combo ever
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
    <main className="min-h-screen bg-surface px-6 py-6 text-ink">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="flex items-center gap-3.5">
          <RaisedButton variant="outline" size="sm" onClick={onBack}>
            ← Progress
          </RaisedButton>
          <span className="text-2xl font-extrabold">Chord stats</span>
          <span className="flex-1" />
          <span className="text-[13px] text-ink-muted">
            tap a column to sort
          </span>
        </header>

        {rows.length === 0 ? (
          <Card className="p-10 text-center text-ink-muted">
            No practiced chords yet. Play a few prompts and this page fills up.
          </Card>
        ) : (
          <>
            <Card className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[15px]">
                <thead>
                  <tr className="border-b-2 border-track">
                    <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                      Chord
                    </th>
                    {COLUMNS.map((col) => (
                      <th key={col.id} className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => onSortClick(col.id)}
                          className={cx(
                            'flex items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors hover:text-ink',
                            sort.column === col.id
                              ? 'text-ink'
                              : 'text-ink-muted',
                          )}
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
                      className="border-b border-track last:border-0"
                    >
                      <td className="px-4 py-2.5 font-semibold text-ink">
                        {row.label}
                      </td>
                      {COLUMNS.map((col) => (
                        <td key={col.id} className="px-4 py-2.5 text-ink-soft">
                          {col.id === 'grade' ? (
                            <GradeBadge grade={row.metrics.grade} />
                          ) : (
                            col.format(row)
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <p className="max-w-3xl text-[13px] text-ink-muted">
              Every combo practiced so far, lifetime across all presets. Recent
              accuracy is the last {RECENT_OUTCOME_WINDOW} attempts (the same
              window that drives weighting); recent avg time is the last{' '}
              {RECENT_TIME_WINDOW}. Grade (A–F) folds recent accuracy and speed
              into one figure — the same one that drives which chords come up
              more often, and that gates new unlocks.
            </p>
          </>
        )}
      </div>
    </main>
  )
}

// Grade cell tint (§7.5): A/B green, C neutral, D/F red — the same three tiers
// the prototype shows, so a glance down the column reads as a heat map.
const GRADE_TINT: Record<ComboMetrics['grade'], string> = {
  A: 'bg-primary-tint text-primary-light',
  B: 'bg-primary-tint text-primary-light',
  C: 'bg-track text-ink-soft',
  D: 'bg-danger-tint text-danger',
  F: 'bg-danger-tint text-danger',
}

function GradeBadge({ grade }: { grade: ComboMetrics['grade'] }) {
  return (
    <span
      className={cx(
        'inline-flex h-7 w-7 items-center justify-center rounded-lg text-sm font-extrabold',
        GRADE_TINT[grade],
      )}
    >
      {grade}
    </span>
  )
}
