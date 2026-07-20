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
  comboLabel,
  parseComboKey,
  rankMostImproved,
  rankWorstCombos,
  type Combo,
} from '../practice'
import { voicingLibrary } from '../theory'
import { useSettings } from '../store/settingsStore'
import { useLibrary } from '../store/libraryStore'

// The §7 History view: persisted trends across all sessions — accuracy and
// time-to-correct per day, most-improved/worst chords over every recorded
// combo (not just the active preset), the streak calendar, and the lifetime
// best combo streak. Reads the persisted records once per mount; practice is
// paused while it's open.

const TREND_DAYS = 30
const CALENDAR_WEEKS = 12

// Chart mark colors, validated (dataviz six checks) against the slate-950
// surface: emerald-600 for accuracy, sky-600 for time.
const ACCURACY_BAR = 'bg-emerald-600'
const TIME_BAR = 'bg-sky-600'

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

export function HistoryView({ onBack }: { onBack: () => void }) {
  const goalMinutes = useSettings((s) => s.settings.dailyGoalMinutes)
  // Stat keys may reference custom voicing rules (Phase 9) — resolve labels
  // against the full library; keys for since-deleted rules parse to null.
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

    const combos = Object.keys(comboStats)
      .map((key) => parseComboKey(key, library))
      .filter((combo): combo is Combo => combo !== null)
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
    <main className="flex min-h-screen flex-col bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between gap-4 border-b border-slate-800 px-6 py-3">
        <h1 className="text-lg font-bold tracking-tight">
          PlayingChord{' '}
          <span className="font-normal text-slate-400">— History</span>
        </h1>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
        >
          ← Practice
        </button>
      </header>

      {data.empty ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-slate-400">
          <p>
            No practice history yet.
            <br />
            Play a few prompts and this page fills up.
          </p>
        </div>
      ) : (
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8">
          <section className="flex flex-wrap gap-8">
            <HistoryStat label="Current streak" value={`🔥 ${data.streak}`} />
            <HistoryStat label="Best streak" value={String(data.bestStreak)} />
            <HistoryStat
              label="Best combo"
              value={String(data.bestComboStreak)}
            />
            <HistoryStat
              label="Days practiced"
              value={String(data.daysPracticed)}
            />
            <HistoryStat
              label="Total prompts"
              value={String(data.totalPrompts)}
            />
          </section>

          <StreakCalendar
            days={data.calendarKeys}
            records={data.dailyRecords}
            goalMinutes={goalMinutes}
          />

          <TrendChart
            title="First-try accuracy"
            days={data.accuracyDays}
            domainMax={100}
            barClass={ACCURACY_BAR}
          />
          <TrendChart
            title="Avg time to correct"
            days={data.timeDays}
            domainMax={null}
            barClass={TIME_BAR}
          />

          <section className="grid gap-8 sm:grid-cols-2">
            <ComboList
              title="Most improved"
              hint="recent window vs lifetime miss rate"
              rows={data.improved}
            />
            <ComboList
              title="Worst chords"
              hint="lifetime, across all presets"
              rows={data.worst}
            />
          </section>
        </div>
      )}
    </main>
  )
}

function HistoryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-2xl font-semibold text-slate-100">{value}</div>
    </div>
  )
}

// Single-series day columns (30 slots): 4px-rounded data ends on a square
// baseline, 2px surface gaps, native tooltips per day. Days without prompts
// render as gaps, not zeros.
function TrendChart({
  title,
  days,
  domainMax,
  barClass,
}: {
  title: string
  days: TrendDay[]
  domainMax: number | null // null = scale to the observed peak
  barClass: string
}) {
  const values = days.flatMap((d) => (d.value === null ? [] : [d.value]))
  const peak = values.length > 0 ? Math.max(...values) : 0
  const max = domainMax ?? Math.max(1, Math.ceil(peak))
  const first = days[0]
  const last = days[days.length - 1]

  return (
    <section aria-label={title}>
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-slate-300">{title}</h3>
        <span className="text-xs text-slate-500">
          last {days.length} days
          {domainMax === null && values.length > 0
            ? ` · peak ${peak.toFixed(1)}s`
            : ''}
        </span>
      </div>
      {values.length === 0 ? (
        <p className="mt-2 border-b border-slate-800 pb-2 text-sm text-slate-500">
          Nothing recorded in this window yet.
        </p>
      ) : (
        <div className="mt-2 flex h-24 items-end gap-[2px] border-b border-slate-800">
          {days.map((day) =>
            day.value === null ? (
              <div
                key={day.key}
                className="max-w-6 flex-1"
                title={day.detail}
              />
            ) : (
              <div
                key={day.key}
                className={`max-w-6 flex-1 rounded-t ${barClass}`}
                style={{
                  height: `${Math.max(3, (100 * day.value) / max)}%`,
                }}
                title={day.detail}
              />
            ),
          )}
        </div>
      )}
      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
        <span>{first ? shortDate(first.key) : ''}</span>
        <span>{last ? shortDate(last.key) : ''}</span>
      </div>
    </section>
  )
}

// GitHub-style goal calendar: columns are weeks, rows Mon–Sun. A sequential
// emerald ramp carries "how much practice"; goal-met days additionally get
// a dot so the state never rides on color alone.
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
  // Monday-first row offset for the leading partial week.
  const leadingPad = firstDay ? (parseDateKey(firstDay).getDay() + 6) % 7 : 0

  return (
    <section aria-label="Goal calendar">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-slate-300">Goal calendar</h3>
        <span className="text-xs text-slate-500">
          last {CALENDAR_WEEKS} weeks · goal {goalMinutes} min/day
        </span>
      </div>
      <div
        className="mt-2 grid w-fit grid-flow-col gap-[2px]"
        style={{ gridTemplateRows: 'repeat(7, 0.75rem)' }}
      >
        {Array.from({ length: leadingPad }, (_, i) => (
          <div key={`pad-${i}`} aria-hidden className="h-3 w-3" />
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
              className={`flex h-3 w-3 items-center justify-center rounded-sm ${
                met
                  ? 'bg-emerald-600'
                  : practiced
                    ? 'bg-emerald-900'
                    : 'bg-slate-800'
              }`}
            >
              {met && (
                <span className="block h-1 w-1 rounded-full bg-emerald-100" />
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex gap-4 text-[10px] text-slate-500">
        <CalendarKey swatch="bg-slate-800" label="rest day" />
        <CalendarKey swatch="bg-emerald-900" label="practiced" />
        <CalendarKey swatch="bg-emerald-600" label="goal met" dotted />
      </div>
    </section>
  )
}

function CalendarKey({
  swatch,
  label,
  dotted = false,
}: {
  swatch: string
  label: string
  dotted?: boolean
}) {
  return (
    <span className="flex items-center gap-1">
      <span
        className={`flex h-3 w-3 items-center justify-center rounded-sm ${swatch}`}
      >
        {dotted && (
          <span className="block h-1 w-1 rounded-full bg-emerald-100" />
        )}
      </span>
      {label}
    </span>
  )
}

function ComboList({
  title,
  hint,
  rows,
}: {
  title: string
  hint: string
  rows: { key: string; label: string; metric: string }[]
}) {
  return (
    <section aria-label={title}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-300">{title}</h3>
        <span className="text-xs text-slate-500">{hint}</span>
      </div>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">Nothing here yet.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5 text-sm">
          {rows.map((row) => (
            <li key={row.key} className="flex justify-between gap-2">
              <span className="text-slate-200">{row.label}</span>
              <span className="text-slate-400">{row.metric}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
