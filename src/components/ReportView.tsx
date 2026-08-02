import { useEffect, useState } from 'react'
import { usePractice } from '../store/practiceStore'
import { useSettings } from '../store/settingsStore'
import { MODE_POLICY, type ComboGrade, type SessionReport } from '../practice'
import { Card, RaisedButton, SectionLabel } from './ui'
import { cx } from './cx'
import { gradeRing } from './grades'

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
  const learn = MODE_POLICY[report.mode].hasLearnLoop

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
              {/* The badge takes the letter's own color (§7.5) — an F in a
                  green ring read as praise for a session that wasn't. */}
              <div
                className={cx(
                  'flex h-[74px] w-[74px] items-center justify-center rounded-full border-[3px] text-3xl font-extrabold',
                  gradeRing(report.grade),
                )}
              >
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
              value={formatMinutesAdded(report.increment.activeMinutes)}
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
              increment={formatMinutesAdded(report.increment.activeMinutes)}
            />
          </div>
        )}

        {report.unlocked !== null && (
          <UnlockBanner unlocked={report.unlocked} />
        )}

        {report.suggestion !== null && (
          <SuggestionCard suggestion={report.suggestion} />
        )}

        {/* The learn loop's own outcome (§5.4). Deliberately *not* the "Chords
            passed" column: these chords reached D on this session's reps
            alone, which unlocks nothing and adds nothing to daily practice —
            proving them for real is what free practice is for, and the line
            below says so rather than leaving the difference to be inferred. */}
        {learn && report.learn !== null && (
          <div className="grid grid-cols-2 gap-3 text-[15px]">
            <div>
              <SectionLabel>Rehearsed</SectionLabel>
              <div className="mt-1 font-semibold text-ink-soft">
                {report.learn.rehearsed.length > 0
                  ? report.learn.rehearsed.join(' · ')
                  : '— none'}
              </div>
            </div>
            <div>
              <SectionLabel>Still to go</SectionLabel>
              <div className="mt-1 font-semibold text-ink-soft">
                {report.learn.remaining.length > 0
                  ? report.learn.remaining.join(' · ')
                  : '— none'}
              </div>
            </div>
            <p className="col-span-2 text-[13px] text-ink-muted">
              Rehearsing is not passing — play these in Free practice, with the
              example hidden, to unlock the next chords.
            </p>
          </div>
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

// The §5.2 offer to narrow or widen the pool, on the one screen where the
// player has just seen the evidence for it (§7.4). A card in the flow rather
// than a modal over it: an F session already gets an encouraging headline by
// design, and a dialog demanding a decision on top of that reads as the app
// telling you to give up. Acting on it is one click; ignoring it is none.
function SuggestionCard({
  suggestion,
}: {
  suggestion: NonNullable<SessionReport['suggestion']>
}) {
  const setChordAside = usePractice((s) => s.setChordAside)
  const openChordForPlay = usePractice((s) => s.openChordForPlay)
  const [done, setDone] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const aside = suggestion.kind === 'set-aside'
  return (
    <Card className="flex flex-wrap items-center gap-3 px-[18px] py-3.5">
      <span className="flex-1 text-[15px] font-semibold text-ink-soft">
        {done ? (
          aside ? (
            <>
              <b className="text-ink">{suggestion.label}</b> set aside — it
              won&rsquo;t be dealt, and it won&rsquo;t hold up the next unlock.
            </>
          ) : (
            <>
              <b className="text-ink">{suggestion.label}</b> is back in play.
            </>
          )
        ) : aside ? (
          <>
            <b className="text-ink">{suggestion.label}</b> is what&rsquo;s
            dragging this preset down. Set it aside for now?
          </>
        ) : (
          <>
            Strong session — ready for{' '}
            <b className="text-ink">{suggestion.label}</b> again?
          </>
        )}
      </span>
      {!done && (
        <div className="flex gap-2">
          <RaisedButton
            variant="outline"
            size="sm"
            onClick={() => {
              if (aside) setChordAside(suggestion.chordKey)
              else openChordForPlay(suggestion.chordKey)
              setDone(true)
            }}
          >
            {aside ? 'Set aside' : 'Bring back'}
          </RaisedButton>
          <RaisedButton
            variant="outline"
            size="sm"
            className="border-card-border"
            onClick={() => setDismissed(true)}
          >
            {aside ? 'Keep it' : 'Not yet'}
          </RaisedButton>
        </div>
      )}
    </Card>
  )
}

interface Delta {
  text: string
  good: boolean
}

// The headline answers the badge beside it (§7.4). It reads off the session
// grade rather than a threshold of its own, so the words and the letter can
// never disagree: the top three letters are praise, and the bottom three turn
// into encouragement — a "Nice session!" over a D is hollow, and it is the D
// session that most needs a reason to start another one.
const HEADLINE: Record<ComboGrade, string> = {
  S: 'Flawless session!',
  A: 'Great session!',
  B: 'Nice session!',
  C: 'Good work — keep going',
  D: 'Every rep counts',
  F: 'Tough one — come back at it',
}

function headline(report: SessionReport): string {
  // The loop either finished its set or was ended part-way (§5.4) — the
  // headline is the first thing read, so it shouldn't congratulate the latter.
  if (MODE_POLICY[report.mode].hasLearnLoop) {
    return report.learn === null || report.learn.remaining.length === 0
      ? 'Set rehearsed!'
      : 'Learning paused'
  }
  // No grade means nothing was graded (a Learn-shaped or empty session).
  return report.grade === null ? 'Session done' : HEADLINE[report.grade]
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

// This session's contribution. A sub-minute session reads "<1 min" rather
// than rounding up to a minute the goal ring never got.
function formatMinutesAdded(minutes: number): string {
  return minutes < 1 ? '<1 min' : `+${Math.round(minutes)} min`
}

function formatHours(minutes: number): string {
  return minutes >= 60
    ? `${(minutes / 60).toFixed(1)}h`
    : `${Math.round(minutes)} min`
}
