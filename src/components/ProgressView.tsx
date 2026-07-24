import { useMemo } from 'react'
import {
  appStorage,
  computeBestStreak,
  computeStreak,
  lastDateKeys,
  localDateKey,
  meetsGoal,
  parseDateKey,
  PersistedComboStats,
  type DailyRecord,
} from '../storage'
import {
  allComboRows,
  comboLabel,
  rankMostImproved,
  rankWorstCombos,
} from '../practice'
import { voicingLibrary } from '../theory'
import { useSettings } from '../store/settingsStore'
import { useLibrary } from '../store/libraryStore'
import { Card, RaisedButton, SectionLabel } from './ui'
import { cx } from './cx'

// The Progress view (DESIGN.md §7.5, formerly History): persisted trends
// across all sessions — the header stat cards, accuracy and time-to-correct
// per day, the streak calendar, most-improved / needs-work chords, and the
// lifetime best combo streak. Reads the persisted records once per mount;
// practice is paused while it's open.

const TREND_DAYS = 30
const CALENDAR_WEEKS = 12

interface TrendDay {
  key: string
  value: number | null // null = no prompts that day (a gap, not a zero)
  detail: string
}

function shortDate(key: string): string {
  return parseDateKey(key).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function formatHours(minutes: number): string {
  return minutes >= 60
    ? `${(minutes / 60).toFixed(1)}h`
    : `${Math.round(minutes)} min`
}

export function ProgressView({
  onBack,
  onChordStats,
}: {
  onBack: () => void
  onChordStats: () => void
}) {
  const goalMinutes = useSettings((s) => s.settings.dailyGoalMinutes)
  const customRules = useLibrary((s) => s.customRules)

  const data = useMemo(() => {
    const library = voicingLibrary(customRules)
    const { dailyRecords, comboStats, bestComboStreak } = appStorage.state
    const todayKey = localDateKey(new Date())
    const trendKeys = lastDateKeys(todayKey, TREND_DAYS)

    const accuracyDays: TrendDay[] = []
    const timeDays: TrendDay[] = []
    for (const key of trendKeys) {
      const record = dailyRecords[key]
      const hasPrompts = record !== undefined && record.prompts > 0
      accuracyDays.push({
        key,
        value: hasPrompts
          ? (100 * record.firstTrySuccesses) / record.prompts
          : null,
        detail: hasPrompts
          ? `${shortDate(key)} — ${Math.round((100 * record.firstTrySuccesses) / record.prompts)}% first-try (${record.prompts} prompts)`
          : `${shortDate(key)} — no prompts`,
      })
      timeDays.push({
        key,
        value: hasPrompts
          ? record.timeToCorrectMs / record.prompts / 1000
          : null,
        detail: hasPrompts
          ? `${shortDate(key)} — ${(record.timeToCorrectMs / record.prompts / 1000).toFixed(1)}s avg to correct`
          : `${shortDate(key)} — no prompts`,
      })
    }

    const combos = allComboRows(comboStats, library).map((row) => row.combo)
    const stats = new PersistedComboStats(appStorage)
    const allRecords = Object.values(dailyRecords)
    return {
      accuracyDays,
      timeDays,
      calendarKeys: lastDateKeys(todayKey, CALENDAR_WEEKS * 7),
      dailyRecords,
      streak: computeStreak(dailyRecords, goalMinutes, todayKey),
      bestStreak: computeBestStreak(dailyRecords, goalMinutes),
      bestComboStreak,
      totalMinutes: allRecords.reduce((sum, r) => sum + r.activeMinutes, 0),
      daysPracticed: allRecords.filter(
        (r) => r.prompts > 0 || r.activeMinutes > 0,
      ).length,
      totalPrompts: allRecords.reduce((sum, r) => sum + r.prompts, 0),
      improved: rankMostImproved(combos, stats).map((entry) => ({
        key: `${entry.combo.root}:${entry.combo.typeId}:${entry.combo.voicingId}`,
        label: comboLabel(entry.combo, undefined, library),
        metric: `▲ ${Math.round(entry.improvement * 100)} pts`,
      })),
      worst: rankWorstCombos(combos, stats).map(({ combo, record }) => ({
        key: `${combo.root}:${combo.typeId}:${combo.voicingId}`,
        label: comboLabel(combo, undefined, library),
        metric: `${Math.round((100 * record.firstTrySuccesses) / record.attempts)}% first-try`,
      })),
      empty: allRecords.length === 0 && combos.length === 0,
    }
  }, [goalMinutes, customRules])

  return (
    <main className="min-h-screen bg-surface px-6 py-6 text-ink">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="flex items-center gap-3.5">
          <RaisedButton variant="outline" size="sm" onClick={onBack}>
            ← Home
          </RaisedButton>
          <span className="text-2xl font-extrabold">Progress</span>
          <span className="flex-1" />
          <span className="flex items-center gap-2 rounded-[14px] border-2 border-card-border bg-card px-3.5 py-1.5 text-sm font-extrabold">
            🔥 {data.streak}
          </span>
        </header>

        {data.empty ? (
          <Card className="p-10 text-center text-ink-muted">
            No practice history yet. Play a few prompts and this page fills up.
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Best streak" value={`${data.bestStreak} days`} />
              <StatCard
                label="Total practice time"
                value={formatHours(data.totalMinutes)}
              />
              <StatCard
                label="Days practiced"
                value={String(data.daysPracticed)}
              />
              <StatCard
                label="Total prompts"
                value={String(data.totalPrompts)}
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <TrendChart
                title="First-try accuracy"
                hint="30 days"
                days={data.accuracyDays}
                domainMax={100}
                barClass="bg-primary"
              />
              <TrendChart
                title="Time to correct"
                hint="30 days · lower is better"
                days={data.timeDays}
                domainMax={null}
                barClass="bg-info"
              />
            </div>

            <div className="grid gap-3 lg:grid-cols-[auto_1fr_1fr]">
              <StreakCalendar
                days={data.calendarKeys}
                records={data.dailyRecords}
                goalMinutes={goalMinutes}
              />
              <ComboList
                title="▲ Most improved"
                titleClass="text-primary-light"
                rows={data.improved}
                metricClass="text-primary-light"
              />
              <ComboList
                title="Needs work"
                titleClass="text-danger"
                rows={data.worst}
                metricClass="text-danger"
              />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <RaisedButton
                variant="raised"
                size="sm"
                className="text-primary-light"
                onClick={onChordStats}
              >
                Every chord's stats →
              </RaisedButton>
              <span className="text-sm text-ink-muted">
                Best combo streak:{' '}
                <b className="text-ink">{data.bestComboStreak}</b> first-try in
                a row
              </span>
            </div>
          </>
        )}
      </div>
    </main>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="px-4 py-3">
      <SectionLabel className="text-xs">{label}</SectionLabel>
      <div className="text-[26px] font-extrabold">{value}</div>
    </Card>
  )
}

// Single-series day columns (30 slots). Days without prompts render as gaps,
// not zeros. Chart colors: primary green for accuracy, info blue for time —
// each reads clearly on the navy card (dataviz).
function TrendChart({
  title,
  hint,
  days,
  domainMax,
  barClass,
}: {
  title: string
  hint: string
  days: TrendDay[]
  domainMax: number | null
  barClass: string
}) {
  const values = days.flatMap((d) => (d.value === null ? [] : [d.value]))
  const peak = values.length > 0 ? Math.max(...values) : 0
  const max = domainMax ?? Math.max(1, Math.ceil(peak))

  return (
    <Card className="px-[18px] py-4" aria-label={title}>
      <div className="flex items-baseline justify-between">
        <b className="text-base">{title}</b>
        <span className="text-xs text-ink-muted">{hint}</span>
      </div>
      {values.length === 0 ? (
        <p className="mt-2.5 border-b-2 border-track pb-2 text-sm text-ink-muted">
          Nothing recorded in this window yet.
        </p>
      ) : (
        <div className="mt-2.5 flex h-[76px] items-end gap-[2px] border-b-2 border-track">
          {days.map((day) =>
            day.value === null ? (
              <div
                key={day.key}
                className="max-w-[18px] flex-1"
                title={day.detail}
              />
            ) : (
              <div
                key={day.key}
                className={cx('max-w-[18px] flex-1 rounded-t', barClass)}
                style={{ height: `${Math.max(4, (100 * day.value) / max)}%` }}
                title={day.detail}
              />
            ),
          )}
        </div>
      )}
    </Card>
  )
}

function StreakCalendar({
  days,
  records,
  goalMinutes,
}: {
  days: string[]
  records: Readonly<Record<string, DailyRecord>>
  goalMinutes: number
}) {
  const firstDay = days[0]
  const leadingPad = firstDay ? (parseDateKey(firstDay).getDay() + 6) % 7 : 0

  return (
    <Card
      className="flex flex-col gap-2.5 px-[18px] py-4"
      aria-label="Goal calendar"
    >
      <div className="flex flex-col">
        <b className="text-base">Goal calendar</b>
        <span className="text-xs text-ink-muted">
          {CALENDAR_WEEKS} weeks · {goalMinutes} min/day
        </span>
      </div>
      <div
        className="grid w-fit grid-flow-col gap-[3px]"
        style={{ gridTemplateRows: 'repeat(7, 0.6875rem)' }}
      >
        {Array.from({ length: leadingPad }, (_, i) => (
          <div key={`pad-${i}`} aria-hidden className="h-[11px] w-[11px]" />
        ))}
        {days.map((key) => {
          const record = records[key]
          const practiced =
            record !== undefined &&
            (record.activeMinutes > 0 || record.prompts > 0)
          const met = meetsGoal(record, goalMinutes)
          const minutes = Math.round(record?.activeMinutes ?? 0)
          const label = `${shortDate(key)} — ${
            practiced ? `${minutes} min${met ? ' ✓ goal met' : ''}` : 'rest day'
          }`
          return (
            <div
              key={key}
              role="img"
              aria-label={label}
              title={label}
              className={cx(
                'flex h-[11px] w-[11px] items-center justify-center rounded-sm',
                met ? 'bg-primary' : practiced ? 'bg-primary-tint' : 'bg-track',
              )}
            >
              {met && (
                <span className="block h-1 w-1 rounded-full bg-primary-ink" />
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function ComboList({
  title,
  titleClass,
  rows,
  metricClass,
}: {
  title: string
  titleClass: string
  rows: { key: string; label: string; metric: string }[]
  metricClass: string
}) {
  return (
    <Card className="px-[18px] py-4 text-[15px]" aria-label={title}>
      <b className={cx('text-base', titleClass)}>{title}</b>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">Nothing here yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5 font-semibold text-ink-soft">
          {rows.map((row) => (
            <li key={row.key} className="flex justify-between gap-2">
              <span>{row.label}</span>
              <span className={metricClass}>{row.metric}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
