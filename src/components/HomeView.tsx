import { useMemo } from 'react'
import { usePractice } from '../store/practiceStore'
import { useSettings } from '../store/settingsStore'
import {
  appStorage,
  lastDateKeys,
  localDateKey,
  meetsGoal,
  weekFirstTryDelta,
} from '../storage'
import { DevicePicker } from './DevicePicker'
import { Card, RaisedButton } from './ui'
import { cx } from './cx'
import { TodayCard, type StartIntent } from './TodayCard'
import { RepertoireRow } from './RepertoireRow'

// The Home screen (DESIGN.md §4.1): the path's face. The no-device gate (§6.1)
// doesn't block it.
//
// v9 asked the player to assemble a session here — preset, then mode, then
// Start — which put the pedagogy on the person least able to do it. Home is now
// a shell around the Today card: it carries identity and the day's numbers, and
// the card owns the decision. The mode selector is gone entirely, because
// Learn-vs-Practice is no longer a choice anyone makes (§3.1).
export function HomeView({
  onStart,
  onFreePractice,
  onSettings,
  onProgress,
  onPathMap,
}: {
  onStart: (intent: StartIntent, chapterId?: string) => void
  onFreePractice: () => void
  onSettings: () => void
  onProgress: () => void
  onPathMap: () => void
}) {
  const goal = usePractice((s) => s.goal)
  const path = usePractice((s) => s.path)
  const goalMinutes = useSettings((s) => s.settings.dailyGoalMinutes)

  // 14-day mini calendar + this-week delta, read once per mount. Home remounts
  // after every session, so this is always the latest.
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

  return (
    <main className="min-h-screen bg-surface px-6 py-6 text-ink">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="flex items-center gap-3">
          <span className="text-xl font-extrabold tracking-tight">
            PlayingChord
          </span>
          <BuildTag />
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
          <div className="flex flex-col gap-4">
            <TodayCard onStart={onStart} onFreePractice={onFreePractice} />
            <RepertoireRow onPathMap={onPathMap} />
            {/* Free practice reads as the side door it now is: hollow, quiet,
                and saying so in words (§4.3). */}
            <div className="flex items-center gap-3 rounded-[20px] border-2 border-muted-border px-5 py-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-base font-extrabold text-ink-soft">
                  Free practice
                </span>
                <span className="text-sm font-semibold text-ink-muted">
                  Any preset, any mode, any length — no gate
                </span>
              </div>
              <span className="flex-1" />
              <RaisedButton
                variant="outline"
                size="sm"
                onClick={onFreePractice}
              >
                Open ▾
              </RaisedButton>
            </div>
          </div>

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
              onClick={onPathMap}
            >
              🗺 Path map
              <span className="text-[13px] font-semibold text-info-light">
                ch. {Math.min(path.chapterNumber, path.chapterTotal)} /{' '}
                {path.chapterTotal}
              </span>
              <span className="ml-auto text-ink-muted">→</span>
            </RaisedButton>

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

// The spec version this build implements, next to the wordmark (§7.1). A
// build off any branch but master also names the branch — that is the whole
// point on a deployed preview, where the URL is the same as production's.
function BuildTag() {
  const preview = __APP_BRANCH__ !== '' && __APP_BRANCH__ !== 'master'
  return (
    <span className="self-end pb-0.5 text-[11px] font-semibold text-ink-muted">
      v{__APP_VERSION__}
      {preview && (
        <>
          {' · '}
          <b className="text-info">{__APP_BRANCH__}</b>
        </>
      )}
    </span>
  )
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
