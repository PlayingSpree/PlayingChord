import { useMemo, useState } from 'react'
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
import {
  worstChordDisplayGrade,
  type DisplayGrade,
  type SessionMode,
} from '../practice'
import { DevicePicker } from './DevicePicker'
import { Card, Chip, RaisedButton, SectionLabel } from './ui'
import { cx } from './cx'
import { gradeText } from './grades'

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

// The learning loop is never started from here — the path starts it (§4.1), and
// MODES above deliberately doesn't list it. The label exists only because the
// record is exhaustive over SessionMode.
const START_LABEL: Record<SessionMode, string> = {
  learn: 'Start learning ▶',
  practice: 'Start practicing ▶',
  song: 'Start song ▶',
  'path-learn': 'Learn these ▶',
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
  const canSetChordAside = usePractice((s) => s.canSetChordAside)
  const chordsOpenedWith = usePractice((s) => s.chordsOpenedWith)
  const setChordAside = usePractice((s) => s.setChordAside)
  const openChordForPlay = usePractice((s) => s.openChordForPlay)
  const goalMinutes = useSettings((s) => s.settings.dailyGoalMinutes)
  const customRules = useLibrary((s) => s.customRules)
  const [showLocked, setShowLocked] = useState(false)
  // The §5.2 by-hand pool controls. Behind a toggle rather than always on:
  // the row is read far more often than it is edited, and a chip that sets a
  // chord aside on a stray click would be a trap in a row you scan every
  // session.
  const [editing, setEditing] = useState(false)

  const presetName = presets.find((p) => p.id === presetId)?.name ?? 'Practice'

  // In-play chips: unlocked chords with their worst-combo grade (§7.1), plus
  // the locked ones behind the 🔒 chip. Read the persisted per-combo stats
  // once — Home re-mounts after every session, so the grades reflect the
  // latest play. `customRules` in the deps keeps it in step with a library
  // edit.
  const inPlay = useMemo(() => {
    const comboStats = appStorage.state.comboStats
    const entries = chordPassStatus()
    const withGrade = (chord: (typeof entries)[number]) => {
      const records = Object.entries(comboStats)
        .filter(([key]) => key.startsWith(`${chord.key}:`))
        .map(([, record]) => record)
      return {
        key: chord.key,
        label: chord.label,
        passed: chord.passed,
        grade: worstChordDisplayGrade(records),
        canSetAside: canSetChordAside(chord.key),
      }
    }
    const chips = entries
      .filter((chord) => chord.unlocked && !chord.setAside)
      .map(withGrade)
    // Set aside by hand (§5.2): unlocked, but held out of play. Shown beside
    // the row rather than folded into the 🔒 chip — these are chords the
    // player benched and owes themselves, not ones they haven't reached.
    const aside = entries
      .filter((chord) => chord.unlocked && chord.setAside)
      .map(withGrade)
    // Locked chords keep their unlock order (§5.1) — the list reads as
    // "what's coming next", so the head of it is the next batch.
    const locked = entries
      .filter((chord) => !chord.unlocked)
      .map((chord) => ({
        key: chord.key,
        label: chord.label,
        opensWith: chordsOpenedWith(chord.key),
      }))
    return { chips, aside, locked }
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
              <div className="flex items-center gap-3">
                <SectionLabel>In play</SectionLabel>
                <button
                  type="button"
                  className={cx(
                    'text-[13px] font-bold',
                    editing ? 'text-info-light' : 'text-ink-muted',
                  )}
                  aria-pressed={editing}
                  onClick={() => setEditing((open) => !open)}
                >
                  {editing ? 'Done' : '✎ Edit pool'}
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {inPlay.chips.map((chip) => (
                  <InPlayChip
                    key={chip.key}
                    label={chip.label}
                    passed={chip.passed}
                    grade={chip.grade}
                    action={
                      editing && chip.canSetAside
                        ? { glyph: '✕', run: () => setChordAside(chip.key) }
                        : null
                    }
                  />
                ))}
                {inPlay.aside.map((chip) => (
                  <Chip
                    key={chip.key}
                    tone="locked"
                    className="px-3 py-1.5 text-sm"
                    onClick={
                      editing ? () => openChordForPlay(chip.key) : undefined
                    }
                  >
                    💤 {chip.label}
                    {chip.grade !== null && (
                      <b
                        className={cx('font-extrabold', gradeText(chip.grade))}
                      >
                        {chip.grade}
                      </b>
                    )}
                    {editing && <span aria-hidden>↩</span>}
                  </Chip>
                ))}
                {inPlay.locked.length > 0 && (
                  <Chip
                    tone="locked"
                    className="px-3 py-1.5 text-sm"
                    onClick={() => setShowLocked((open) => !open)}
                    aria-expanded={showLocked}
                  >
                    🔒 {inPlay.locked.length} locked {showLocked ? '▴' : '▾'}
                  </Chip>
                )}
              </div>
              {editing && (
                <p className="text-[13px] text-ink-muted">
                  Set a chord aside to stop it being dealt — it also stops
                  holding up the next unlock. Bring it back any time.
                </p>
              )}
              {/* What's still to come, in unlock order (§5.1) — the chip is a
                  disclosure rather than a popover so it needs no focus trap.
                  Editing opens it too: unlocking early (§5.2) is the other
                  half of the controls and it acts on this list. */}
              {(showLocked || editing) && inPlay.locked.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {inPlay.locked.map((chord) => (
                    <Chip
                      key={chord.key}
                      tone="locked"
                      className="px-3 py-1.5 text-sm"
                      onClick={
                        editing ? () => openChordForPlay(chord.key) : undefined
                      }
                      // The frontier is a prefix (§5.1), so opening one chord
                      // opens everything ahead of it — said on the control
                      // rather than done silently.
                      title={
                        editing
                          ? chord.opensWith > 0
                            ? `Unlock now — also opens the ${chord.opensWith} chord${chord.opensWith === 1 ? '' : 's'} before it`
                            : 'Unlock now'
                          : undefined
                      }
                    >
                      {chord.label}
                      {editing && (
                        <span aria-hidden>
                          🔓{chord.opensWith > 0 && ` +${chord.opensWith}`}
                        </span>
                      )}
                    </Chip>
                  ))}
                </div>
              )}
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

// `action`, when given, makes the whole chip the button for it (§5.2) — a
// nested button inside a chip would be invalid markup, and the row is only
// clickable while editing anyway.
function InPlayChip({
  label,
  passed,
  grade,
  action,
}: {
  label: string
  passed: boolean
  grade: DisplayGrade | null
  action?: { glyph: string; run: () => void } | null
}) {
  const onClick = action ? action.run : undefined
  if (!passed) {
    return (
      <Chip tone="info" className="px-3 py-1.5 text-sm" onClick={onClick}>
        {label} · learning
        {action && <span aria-hidden>{action.glyph}</span>}
      </Chip>
    )
  }
  return (
    <Chip className="px-3 py-1.5 text-sm" onClick={onClick}>
      {label}
      {grade !== null && (
        <b className={cx('font-extrabold', gradeText(grade))}>{grade}</b>
      )}
      {action && <span aria-hidden>{action.glyph}</span>}
    </Chip>
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
