import { useMemo, useState } from 'react'
import { resolveAppPool, usePractice } from '../store/practiceStore'
import { useSettings } from '../store/settingsStore'
import { useLibrary } from '../store/libraryStore'
import {
  appStorage,
  dailyCounts,
  lastDateKeys,
  localDateKey,
  meetsGoal,
  recordsForSide,
  weekFirstTryDelta,
} from '../storage'
import {
  dailyLegMinutes,
  dailyLegRemaining,
  dueDailyLeg,
  type DisplayGrade,
  type Side,
} from '../practice'
import { DevicePicker } from './DevicePicker'
import { MODE_LABELS, START_LABEL } from './modes'
import {
  counted,
  noun,
  presetModeOf,
  presetModes,
  SIDE_LABELS,
  SIDES,
} from './sides'
import { Card, Chip, RaisedButton, SectionLabel } from './ui'
import { cx } from './cx'
import { gradeText } from './grades'
import { formatMinutes } from './daily'

// The Home screen (DESIGN.md §7.1): the entry point. The no-device gate
// (§6.1) doesn't block it. Top bar, the Daily card (both sides' legs, above
// the side switch), the Continue card
// (preset, unlock progress, the "In play" grade row, the mode selector and
// Start), the daily goal ring, a 14-day mini calendar, and the Progress button with this
// week's first-try delta. `onOpenSheet` opens the session sheet for full
// config (preset / mode / length, §7.2).
// The Continue card is about the *selected preset* — its unlock progress and
// its in-play chords — which is what Learn, free practice and Song draw from.
// Daily practice doesn't (§5.3: every preset's passed chords under a time
// cap), so it is a card of its own above, one click to start, rather than a
// mode chip beside a preset it ignores.
// Everything on the card is the switched-to side's (§7.1): the Chords |
// Scales switch above it picks the side, and with it the preset, the pool,
// the modes and the records the Progress button reads. The goal ring, the
// calendar and the streak are about time, so they stay shared.

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
  const side = usePractice((s) => s.side)
  const setSide = usePractice((s) => s.setSide)
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
  const dailyCapMinutes = useSettings((s) => s.settings.dailyCapMinutes)
  const dailyChordShare = useSettings((s) => s.settings.dailyChordShare)
  const dailyPlan = usePractice((s) => s.dailyPlan)
  const prepareDaily = usePractice((s) => s.prepareDaily)
  const diatonicKey = usePractice((s) => s.diatonicKey)
  const learnSet = usePractice((s) => s.learnSelection)
  const customRules = useLibrary((s) => s.customRules)
  const [showLocked, setShowLocked] = useState(false)
  // The §5.2 by-hand pool controls. Behind a toggle rather than always on:
  // the row is read far more often than it is edited, and a chip that sets a
  // chord aside on a stray click would be a trap in a row you scan every
  // session.
  const [editing, setEditing] = useState(false)

  const presetName = presets.find((p) => p.id === presetId)?.name ?? 'Practice'

  // In-play chips: unlocked chords with their worst-combo grade (§7.1), plus
  // the locked ones behind the 🔒 chip. Each grade is the pool's own fold, the
  // figure the pass is judged on (§5.1) — Home re-mounts after every session,
  // so it reflects the latest play. `customRules` in the deps keeps it in step
  // with a library edit.
  const inPlay = useMemo(() => {
    const entries = chordPassStatus()
    const withGrade = (chord: (typeof entries)[number]) => ({
      key: chord.key,
      label: chord.label,
      passed: chord.passed,
      grade: chord.grade,
      canSetAside: canSetChordAside(chord.key),
    })
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
    // "what's coming next", so the head of it opens next.
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

  // What the learn loop would deal (§5.4): the chords currently selected — the
  // sheet's picks, which default to the ones not yet passed — and the
  // passed chords that would keep it at three.
  const learnFiller = useMemo(
    () => resolveAppPool(presetId, diatonicKey).fillerLabels(learnSet),
    // The pool is resolved fresh, so re-run on anything that moves it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [presetId, diatonicKey, learnSet, progress, customRules],
  )

  // What daily practice would deal (§5.3), across every preset of both
  // sides, and how much of each leg today has already played — read from the
  // persisted records on the same triggers as the row above, plus the cap
  // and split. Home re-mounts after every session, so today's minutes are
  // current.
  const plan = useMemo(
    () => dailyPlan(),
    // dailyPlan is a stable store method; re-run on progress/library/settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [side, presetId, progress, customRules, dailyCapMinutes, dailyChordShare],
  )

  // 14-day mini calendar + this-week delta, read once per mount. The
  // calendar is shared — any practice counts — while the week's accuracy is
  // the side's own: a combined figure would move with the mix (§7.1).
  const { calendar, week } = useMemo(() => {
    const { dailyRecords } = appStorage.state
    const todayKey = localDateKey(new Date())
    const days = lastDateKeys(todayKey, 14).map((key) => {
      const record = dailyRecords[key]
      const practiced =
        record !== undefined &&
        (record.activeMinutes > 0 ||
          record.prompts > 0 ||
          dailyCounts(record, 'scales').prompts > 0)
      return {
        key,
        today: key === todayKey,
        met: meetsGoal(record, goalMinutes),
        practiced,
      }
    })
    return {
      calendar: days,
      week: weekFirstTryDelta(recordsForSide(dailyRecords, side), todayKey),
    }
  }, [goalMinutes, side])

  // The Continue card's mode — never daily, which has its own card.
  const presetMode = presetModeOf(mode)
  const startPresetMode = () => {
    setMode(presetMode)
    onStart()
  }
  // Daily runs a chord leg then a scale leg (§5.3), each to its share of
  // the cap less what today has already played, so a run cut short picks up
  // where it stopped. With nothing passed on either side the card reads as
  // locked; with both legs played out it reads as done for today and offers
  // Keep going — the same passed pool, uncapped, until End. Starting
  // switches Home to the leg's side, since a session runs on the store's
  // side — the way back Home switches it back (§7.1).
  const dailyLegs = SIDES.map((legSide) => ({
    side: legSide,
    share: dailyLegMinutes(legSide, plan),
    remaining: dailyLegRemaining(legSide, plan),
    passed: plan.passed[legSide],
  }))
  const dueLeg = dueDailyLeg(plan)
  const nothingPassed = SIDES.every((s) => plan.passed[s] === 0)
  const startedToday = SIDES.some((s) => plan.playedToday[s] > 0)
  const doneToday = !nothingPassed && dueLeg === null
  const startDaily = () => {
    if (prepareDaily()) onStart()
  }

  // Each pass opens the next item (§5.1), so this is usually one — more only
  // while items opened by hand crowd the learning window.
  const toNextUnlock = progress.toNextUnlock
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

        {/* Above the side switch, with the other things that are about time
            rather than kind (§7.1): one Daily spans both sides (§5.3). */}
        <Card
          className={cx(
            'flex flex-wrap items-center gap-x-4 gap-y-3 px-6 py-4',
            nothingPassed && 'border-dashed',
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-xl font-extrabold">
              {MODE_LABELS.daily}{' '}
              <span className="text-[15px] font-semibold text-ink-muted">
                · {dailyCapMinutes} min{doneToday && ' · ✓ done today'}
              </span>
            </span>
            {nothingPassed ? (
              <span className="text-[15px] text-ink-muted">
                Pass a chord or a scale first — daily practice drills what you
                have passed, from every preset
              </span>
            ) : (
              <span className="flex flex-wrap gap-x-5 text-[15px] text-ink-muted">
                {dailyLegs.map((leg) => (
                  <span key={leg.side}>
                    <b className="font-semibold text-ink-soft">
                      {SIDE_LABELS[leg.side]}
                    </b>{' '}
                    {legLine(leg)}
                  </span>
                ))}
              </span>
            )}
          </div>
          <RaisedButton
            variant={doneToday ? 'outline' : 'primary'}
            disabled={nothingPassed}
            onClick={startDaily}
          >
            {doneToday
              ? 'Keep going ▶'
              : startedToday
                ? 'Continue daily ▶'
                : 'Start daily ▶'}
          </RaisedButton>
        </Card>

        <SideSwitch side={side} onChange={setSide} />

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
                {progress.unlocked} / {progress.total} {noun(side)} unlocked
              </span>
              <div className="h-2.5 w-full max-w-[280px] overflow-hidden rounded-full bg-track">
                <div
                  className="h-full rounded-full bg-info"
                  style={{ width: `${unlockPct}%` }}
                />
              </div>
              {toNextUnlock > 0 && (
                <span>pass {toNextUnlock} more to unlock the next</span>
              )}
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
                  Set a {noun(side, 1)} aside to stop it being dealt — it also
                  stops holding up the next unlock. Bring it back any time.
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
                            ? `Unlock now — also opens the ${counted(side, chord.opensWith)} before it`
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
              {presetModes(side).map((id) => (
                <Chip
                  key={id}
                  selected={presetMode === id}
                  onClick={() => setMode(id)}
                  className="px-4 py-2.5 text-base"
                >
                  {MODE_LABELS[id]}
                </Chip>
              ))}
            </div>

            {/* Learn deals a chosen set plus enough passed chords to make
                three (§5.4), and runs until the set is rehearsed rather than to
                a length — so, like daily, it says what it will deal. The set
                itself is picked in the sheet. */}
            {presetMode === 'learn' && (
              <p className="text-[15px] text-ink-muted">
                <b className="font-semibold text-ink-soft">
                  {counted(side, learnSet.length)} to learn
                </b>
                {learnFiller.length > 0 && (
                  <> · with {learnFiller.join(', ')}</>
                )}{' '}
                · runs until all reach D
              </p>
            )}

            <RaisedButton
              variant="primary"
              size="lg"
              className="w-full"
              onClick={startPresetMode}
            >
              {START_LABEL[presetMode]}
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

// One Daily leg on the card (§5.3): why it won't run, that it's done
// today, how much of it is left, or — untouched today — its share.
function legLine(leg: {
  share: number
  remaining: number
  passed: number
}): string {
  if (leg.passed === 0) return '· nothing passed yet'
  if (leg.share === 0) return '· off'
  if (leg.remaining === 0) return `✓ ${formatMinutes(leg.share)} min done`
  if (leg.remaining < leg.share) {
    return `${formatMinutes(leg.remaining)} of ${formatMinutes(leg.share)} min left · ${leg.passed} passed`
  }
  return `${formatMinutes(leg.share)} min · ${leg.passed} passed`
}

// The Chords | Scales switch (§7.1): a segmented control above the Continue
// card. Home-only — a session runs on one side — and persisted by the store
// with each side's own preset, so switching is never a preset change in
// disguise.
function SideSwitch({
  side,
  onChange,
}: {
  side: Side
  onChange: (side: Side) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Chords or scales"
      className="flex w-full max-w-[320px] overflow-hidden rounded-[14px] border-2 border-card-border"
    >
      {SIDES.map((id) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={side === id}
          onClick={() => onChange(id)}
          className={cx(
            'flex-1 py-2.5 text-[15px] transition-colors',
            side === id
              ? 'bg-primary font-extrabold text-primary-ink'
              : 'font-semibold text-ink-muted hover:text-ink-soft',
          )}
        >
          {SIDE_LABELS[id]}
        </button>
      ))}
    </div>
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
  // Not passed yet: `new`, played or not (§7.1) — no letter, since what it's
  // waiting on is the pass.
  if (!passed) {
    return (
      <Chip tone="info" className="px-3 py-1.5 text-sm" onClick={onClick}>
        {label} · new
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
