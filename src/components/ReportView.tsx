import { useEffect } from 'react'
import { usePractice } from '../store/practiceStore'
import { useSettings } from '../store/settingsStore'
import type { SessionReport } from '../practice'
import { Card, RaisedButton, SectionLabel } from './ui'
import { cx } from './cx'

// The end-of-session Report (DESIGN.md §7.4): a full screen replacing the
// Draft-v5 summary modal. Headline + grade, the four stat cards with
// trailing-baseline deltas and lifetime increments, an unlock banner, the
// passed / still-shaky columns, the goal line, and Go again / Home. Learn
// sessions are stats-neutral (§5) — the reduced variant shows only prompts,
// active time and the goal line. Reads `report` from the store; the parent
// only routes here while it is non-null.
export function ReportView({
  onGoAgain,
  onHome,
}: {
  onGoAgain: () => void
  onHome: () => void
}) {
  const report = usePractice((s) => s.report)
  const goalMinutes = useSettings((s) => s.settings.dailyGoalMinutes)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onHome()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onHome])

  if (report === null) return null
  const learn = report.mode === 'learn'

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-8 text-ink">
      <div className="flex w-full max-w-xl flex-col gap-4">
        <div className="flex items-center gap-4">
          <span className="text-3xl font-extrabold tracking-tight">
            {headline(report)} <span className="text-info">✦</span>
          </span>
          <span className="flex-1" />
          {report.grade !== null && (
            <div className="flex flex-col items-center gap-1">
              <div className="flex h-[74px] w-[74px] items-center justify-center rounded-full border-[3px] border-primary bg-primary-tint text-3xl font-extrabold text-primary-light">
                {report.grade}
              </div>
              <SectionLabel className="text-[11px]">Session grade</SectionLabel>
            </div>
          )}
        </div>

        {learn ? (
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Prompts played"
              value={String(report.promptsPlayed)}
            />
            <StatCard
              label="Active time"
              value={`+${formatMinutes(report.increment.activeMinutes)}`}
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="First-try"
              value={
                report.accuracy === null ? '—' : formatPct(report.accuracy)
              }
              delta={accuracyDelta(report)}
            />
            <StatCard
              label="Avg time"
              value={
                report.avgTimeMs === null ? '—' : formatSecs(report.avgTimeMs)
              }
              delta={timeDelta(report)}
            />
            <StatCard
              label="Total prompts"
              value={String(report.lifetime.prompts)}
              increment={`+${report.increment.prompts}`}
            />
            <StatCard
              label="Total time"
              value={formatHours(report.lifetime.activeMinutes)}
              increment={`+${formatMinutes(report.increment.activeMinutes)}`}
            />
          </div>
        )}

        {report.unlocked !== null && (
          <UnlockBanner unlocked={report.unlocked} />
        )}

        {!learn && (
          <div className="grid grid-cols-2 gap-3 text-[15px]">
            <div>
              <SectionLabel>Chords passed</SectionLabel>
              <div className="mt-1 font-semibold text-ink-soft">
                {report.passedLabels.length > 0
                  ? report.passedLabels.join(' · ')
                  : '— none'}
              </div>
            </div>
            <div>
              <SectionLabel>Still shaky</SectionLabel>
              <div className="mt-1 font-semibold text-ink-soft">
                {report.shaky.length > 0
                  ? report.shaky
                      .map((s) => `${s.label} (${s.misses})`)
                      .join(' · ')
                  : '— none'}
              </div>
            </div>
          </div>
        )}

        <p className="text-[15px] font-extrabold text-info-light">
          {goalLine(report, goalMinutes)}
        </p>

        <div className="flex gap-3">
          <RaisedButton
            autoFocus
            variant="primary"
            size="lg"
            className="flex-1"
            onClick={onGoAgain}
          >
            Go again ▶
          </RaisedButton>
          <RaisedButton variant="outline" size="lg" onClick={onHome}>
            Home
          </RaisedButton>
        </div>
      </div>
    </main>
  )
}

function StatCard({
  label,
  value,
  delta,
  increment,
}: {
  label: string
  value: string
  delta?: Delta | null
  increment?: string
}) {
  return (
    <Card className="px-[18px] py-3.5">
      <SectionLabel>{label}</SectionLabel>
      <div className="text-3xl font-extrabold">
        {value}
        {delta && (
          <span
            className={cx(
              'ml-2 text-base',
              delta.good ? 'text-primary-light' : 'text-danger',
            )}
          >
            {delta.text}
          </span>
        )}
        {increment && (
          <span className="ml-2 text-base text-primary-light">{increment}</span>
        )}
      </div>
    </Card>
  )
}

function UnlockBanner({
  unlocked,
}: {
  unlocked: NonNullable<SessionReport['unlocked']>
}) {
  const pct =
    unlocked.total > 0
      ? Math.round((100 * unlocked.unlocked) / unlocked.total)
      : 0
  return (
    <Card className="flex flex-col gap-2 border-info-border bg-info-tint px-[18px] py-3.5">
      <span className="text-[17px] font-extrabold text-info-light">
        🔓 Unlocked: {unlocked.labels.join(' & ')}
      </span>
      <div className="flex items-center gap-2.5 text-[13px] text-info-light/80">
        <div className="h-2 flex-1 overflow-hidden rounded bg-info-tint ring-1 ring-info-border">
          <div
            className="h-full rounded bg-info"
            style={{ width: `${pct}%` }}
          />
        </div>
        {unlocked.unlocked} / {unlocked.total} — bring every unlocked chord to a
        good grade to open more
      </div>
    </Card>
  )
}

interface Delta {
  text: string
  good: boolean
}

function headline(report: SessionReport): string {
  if (report.mode === 'learn') return 'Learning done'
  if (report.accuracy !== null && report.accuracy >= 0.78)
    return 'Nice session!'
  return 'Session done'
}

// First-try delta vs the baseline, in percentage points; omitted when there's
// no baseline (never "+0 vs nothing", §7.4).
function accuracyDelta(report: SessionReport): Delta | null {
  if (report.accuracy === null || report.baseline.accuracy === null) return null
  const pts = Math.round((report.accuracy - report.baseline.accuracy) * 100)
  return {
    text: pts >= 0 ? `▲ +${pts}` : `▼ ${pts}`,
    good: pts >= 0,
  }
}

// Avg-time delta vs the baseline, in seconds; lower is better (a drop is good).
function timeDelta(report: SessionReport): Delta | null {
  if (report.avgTimeMs === null || report.baseline.avgTimeMs === null) {
    return null
  }
  const diff = (report.avgTimeMs - report.baseline.avgTimeMs) / 1000
  const rounded = diff.toFixed(1)
  return {
    text: diff <= 0 ? `▼ ${rounded}s` : `▲ +${rounded}s`,
    good: diff <= 0,
  }
}

function goalLine(report: SessionReport, goalMinutes: number): string {
  const today = report.goal.todayMinutes
  if (today >= goalMinutes) {
    return `🔥 Streak safe — ${Math.round(today)}/${goalMinutes} min done today`
  }
  const remaining = Math.ceil(goalMinutes - today)
  return `${remaining} more min today to keep the streak`
}

const formatPct = (v: number) => `${Math.round(v * 100)}%`
const formatSecs = (ms: number) => `${(ms / 1000).toFixed(1)}s`

function formatMinutes(minutes: number): string {
  return `${Math.max(1, Math.round(minutes))} min`
}

function formatHours(minutes: number): string {
  return minutes >= 60
    ? `${(minutes / 60).toFixed(1)}h`
    : `${Math.round(minutes)} min`
}
