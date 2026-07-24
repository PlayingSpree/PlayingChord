import { useMemo } from 'react'
import { usePractice } from '../store/practiceStore'
import { useSettings } from '../store/settingsStore'
import { useLibrary } from '../store/libraryStore'
import {
  appStorage,
  lastDateKeys,
  localDateKey,
  meetsGoal,
  weekFirstTryDelta,
} from '../storage'
import { worstChordGrade, type ComboGrade, type SessionMode } from '../practice'
import { DevicePicker } from './DevicePicker'
import { Card, Chip, RaisedButton, SectionLabel } from './ui'
import { cx } from './cx'

// The Home screen (DESIGN.md §7.1): the entry point. The no-device gate
// (§6.1) doesn't block it. Top bar, the Continue card (preset, unlock
// progress, the "In play" grade row, the mode selector and Start), the daily
// goal ring, a 14-day mini calendar, and the Progress button with this
// week's first-try delta. `onOpenSheet` opens the session sheet for full
// config (preset / mode / length, §7.2).
const MODES: { id: SessionMode; label: string }[] = [
  { id: 'learn', label: '🎓 Learn' },
  { id: 'practice', label: '▶ Practice' },
  { id: 'song', label: '♪ Song' },
]

const START_LABEL: Record<SessionMode, string> = {
  learn: 'Start learning ▶',
  practice: 'Start practicing ▶',
  song: 'Start song ▶',
}

export function HomeView({
  onStart,
  onOpenSheet,
  onSettings,
  onProgress,
}: {
  onStart: () => void
  onOpenSheet: () => void
  onSettings: () => void
  onProgress: () => void
}) {
  const presets = usePractice((s) => s.presets)
  const presetId = usePractice((s) => s.presetId)
  const mode = usePractice((s) => s.mode)
  const setMode = usePractice((s) => s.setMode)
  const progress = usePractice((s) => s.progress)
  const goal = usePractice((s) => s.goal)
  const chordPassStatus = usePractice((s) => s.chordPassStatus)
  const goalMinutes = useSettings((s) => s.settings.dailyGoalMinutes)
  const customRules = useLibrary((s) => s.customRules)

  const presetName = presets.find((p) => p.id === presetId)?.name ?? 'Practice'

  // In-play chips: unlocked chords with their worst-combo grade (§7.1). Read
  // the persisted per-combo stats once — Home re-mounts after every session,
  // so the grades reflect the latest play. `customRules` in the deps keeps it
  // in step with a library edit.
  const inPlay = useMemo(() => {
    const comboStats = appStorage.state.comboStats
    const entries = chordPassStatus()
    const chips = entries
      .filter((chord) => chord.unlocked)
      .map((chord) => {
        const records = Object.entries(comboStats)
          .filter(([key]) => key.startsWith(`${chord.key}:`))
          .map(([, record]) => record)
        return {
          key: chord.key,
          label: chord.label,
          passed: chord.passed,
          grade: worstChordGrade(records),
        }
      })
    const locked = entries.filter((chord) => !chord.unlocked).length
    return { chips, locked }
    // chordPassStatus is a stable store method; re-run on preset/progress/lib.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetId, progress, customRules])

  // 14-day mini calendar + this-week delta, read once per mount.
  const { calendar, week } = useMemo(() => {
    const { dailyRecords } = appStorage.state
    const todayKey = localDateKey(new Date())
    const days = lastDateKeys(todayKey, 14).map((key) => {
      const record = dailyRecords[key]
      const practiced =
        record !== undefined && (record.activeMinutes > 0 || record.prompts > 0)
      return {
        key,
        today: key === todayKey,
        met: meetsGoal(record, goalMinutes),
        practiced,
      }
    })
    return {
      calendar: days,
      week: weekFirstTryDelta(dailyRecords, todayKey),
    }
  }, [goalMinutes])

  const nextBatch = Math.min(2, progress.total - progress.unlocked)
  const unlockPct =
    progress.total > 0
      ? Math.round((100 * progress.unlocked) / progress.total)
      : 0

  return (
    <main className="min-h-screen bg-surface px-6 py-6 text-ink">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="flex items-center gap-3">
          <span className="text-xl font-extrabold tracking-tight">
            PlayingChord
          </span>
          <span className="flex-1" />
          <DevicePicker />
          <span className="flex h-10 items-center gap-2 rounded-[14px] border-2 border-card-border bg-card px-4 text-[15px] font-extrabold">
            🔥 {goal.streak} day{goal.streak === 1 ? '' : 's'}
          </span>
          <RaisedButton variant="outline" size="sm" onClick={onSettings}>
            ⚙
          </RaisedButton>
        </header>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
          <Card className="flex flex-col gap-3.5 p-6">
            <SectionLabel>Continue</SectionLabel>
            <div className="flex flex-wrap items-center gap-3.5">
              <span className="text-4xl font-extrabold leading-none">
                {presetName}
              </span>
              <RaisedButton
                variant="outline"
                size="sm"
                className="border-card-border"
                onClick={onOpenSheet}
              >
                Change ▾
              </RaisedButton>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 text-[15px] text-ink-muted">
              <span className="font-semibold text-ink-soft">
                {progress.unlocked} / {progress.total} chords unlocked
              </span>
              <div className="h-2.5 w-full max-w-[280px] overflow-hidden rounded-full bg-track">
                <div
                  className="h-full rounded-full bg-info"
                  style={{ width: `${unlockPct}%` }}
                />
              </div>
              {nextBatch > 0 && <span>{nextBatch} unlock on next pass</span>}
            </div>

            <div className="mt-1 flex flex-col gap-2">
              <SectionLabel>In play</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {inPlay.chips.map((chip) => (
                  <InPlayChip
                    key={chip.key}
                    label={chip.label}
                    passed={chip.passed}
                    grade={chip.grade}
                  />
                ))}
                {inPlay.locked > 0 && (
                  <Chip tone="locked" className="px-3 py-1.5 text-sm">
                    🔒 {inPlay.locked} locked
                  </Chip>
                )}
              </div>
            </div>

            <div className="mt-auto flex flex-wrap gap-2.5 pt-2">
              {MODES.map((m) => (
                <Chip
                  key={m.id}
                  selected={mode === m.id}
                  onClick={() => setMode(m.id)}
                  className="px-4 py-2.5 text-base"
                >
                  {m.label}
                </Chip>
              ))}
            </div>

            <RaisedButton
              variant="primary"
              size="lg"
              className="w-full"
              onClick={onStart}
            >
              {START_LABEL[mode]}
            </RaisedButton>
          </Card>

          <div className="flex flex-col gap-4">
            <Card className="flex items-center gap-[18px] p-5">
              <GoalRing minutes={goal.todayMinutes} goal={goalMinutes} />
              <div className="text-sm leading-snug text-ink-muted">
                <b className="text-base text-ink">Daily goal</b>
                <br />
                {goal.todayMinutes >= goalMinutes
                  ? 'streak safe for today'
                  : `${Math.ceil(goalMinutes - goal.todayMinutes)} more minutes keeps the streak`}
              </div>
            </Card>

            <Card className="flex flex-col gap-2.5 p-5">
              <b className="text-base">Last 2 weeks</b>
              <div className="grid grid-cols-7 gap-[5px]">
                {calendar.map((d) => (
                  <span
                    key={d.key}
                    className={cx(
                      'block h-[22px] w-[22px] rounded-md',
                      d.today
                        ? 'border-2 border-dashed border-info bg-transparent'
                        : d.met
                          ? 'bg-primary'
                          : d.practiced
                            ? 'bg-primary-tint'
                            : 'bg-track',
                    )}
                  />
                ))}
              </div>
            </Card>

            <RaisedButton
              variant="raised"
              className="justify-start gap-3 px-5 py-4 text-[17px] font-extrabold text-ink"
              onClick={onProgress}
            >
              📈 Progress
              {week.accuracy !== null && (
                <span className="text-[13px] font-semibold text-primary-light">
                  {Math.round(week.accuracy * 100)}% this week
                  {week.delta !== null && (week.delta >= 0 ? ' ▲' : ' ▼')}
                </span>
              )}
              <span className="ml-auto text-ink-muted">→</span>
            </RaisedButton>
          </div>
        </div>
      </div>
    </main>
  )
}

function InPlayChip({
  label,
  passed,
  grade,
}: {
  label: string
  passed: boolean
  grade: ComboGrade | null
}) {
  if (!passed) {
    return (
      <Chip tone="info" className="px-3 py-1.5 text-sm">
        {label} · learning
      </Chip>
    )
  }
  return (
    <Chip className="px-3 py-1.5 text-sm">
      {label}
      {grade !== null && (
        <b className={cx('font-extrabold', GRADE_COLOR[grade])}>{grade}</b>
      )}
    </Chip>
  )
}

const GRADE_COLOR: Record<ComboGrade, string> = {
  A: 'text-primary-light',
  B: 'text-primary-light',
  C: 'text-ink-soft',
  D: 'text-danger',
  F: 'text-danger',
}

// The conic-gradient goal ring (§7.1): filled proportion = today's active
// minutes vs the goal, capped at a full turn.
function GoalRing({ minutes, goal }: { minutes: number; goal: number }) {
  const fraction = goal > 0 ? Math.min(1, minutes / goal) : 0
  const degrees = Math.round(fraction * 360)
  return (
    <div
      className="flex h-[104px] w-[104px] flex-none items-center justify-center rounded-full"
      style={{
        background: `conic-gradient(var(--color-info) ${degrees}deg, var(--color-track) 0)`,
      }}
      role="img"
      aria-label={`${Math.round(minutes)} of ${goal} active minutes today`}
    >
      <div className="flex h-[76px] w-[76px] flex-col items-center justify-center rounded-full bg-card">
        <b className="text-lg">
          {Math.floor(minutes)}/{goal}
        </b>
        <span className="text-[11px] text-ink-muted">min</span>
      </div>
    </div>
  )
}
