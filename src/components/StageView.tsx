import { useEffect } from 'react'
import { practiceStore, usePractice } from '../store/practiceStore'
import { useSettings } from '../store/settingsStore'
import { PromptCard } from './PromptCard'
import { KeyboardView } from './KeyboardView'
import { Chip, RaisedButton } from './ui'
import { cx } from './cx'
import { gradeText } from './grades'
import type { PathComboView } from '../practice'

// The in-session Stage (DESIGN.md §7.3). Practice pauses on unmount (leaving
// the Stage, or a remount for a fresh session) and deals a prompt on mount.
//
// The header's center has three shapes now, and which one appears says what kind
// of session this is: the guided path's learning loop shows its chapter and its
// batch (§4.4) because the batch *is* the length; a chapter song counts down to
// its stamp (§3.3); free practice keeps the v9 done/length bar, which becomes the
// daily-goal bar at ∞ (§7.3).
export function StageView({
  onEnd,
  onOpenSheet,
}: {
  onEnd: () => void
  onOpenSheet: () => void
}) {
  useEffect(() => {
    practiceStore.getState().start()
    return () => practiceStore.getState().pause()
  }, [])

  const presets = usePractice((s) => s.presets)
  const presetId = usePractice((s) => s.presetId)
  const mode = usePractice((s) => s.mode)
  const awaitingReady = usePractice((s) => s.awaitingReady)
  const ready = usePractice((s) => s.ready)
  const done = usePractice((s) => s.done)
  const sessionLength = usePractice((s) => s.sessionLength)
  const progress = usePractice((s) => s.progress)
  const song = usePractice((s) => s.song)
  const songChapterId = usePractice((s) => s.songChapterId)
  const path = usePractice((s) => s.path)
  const goal = usePractice((s) => s.goal)
  const tempo = useSettings((s) => s.settings.songTempoBpm)
  const goalMinutes = useSettings((s) => s.settings.dailyGoalMinutes)

  const presetName = presets.find((p) => p.id === presetId)?.name ?? 'Practice'
  const learning = mode === 'path-learn'
  const chapterSong = songChapterId !== null

  return (
    <main className="flex min-h-screen flex-col bg-surface text-ink">
      <header className="flex items-center gap-3.5 px-6 py-4">
        {learning ? (
          <LearningHeader batch={path.batch} chapterTitle={path.chapterTitle} />
        ) : chapterSong ? (
          <ChapterSongHeader
            chapterTitle={path.chapterTitle}
            songChapterTitle={path.songChapterTitle}
            tempo={tempo}
          />
        ) : (
          <>
            <RaisedButton variant="raised" size="sm" onClick={onOpenSheet}>
              {presetName} · {modeLabel(mode)} ▾
            </RaisedButton>
            <FreePracticeCenter
              mode={mode}
              done={done}
              sessionLength={sessionLength}
              todayMinutes={goal.todayMinutes}
              goalMinutes={goalMinutes}
              unlocked={progress.unlocked}
              total={progress.total}
              loopIndex={song?.loopIndex ?? 0}
              tempo={tempo}
            />
          </>
        )}

        <span className="flex-1" />
        <RaisedButton variant="outline" size="sm" onClick={onEnd}>
          End
        </RaisedButton>
      </header>

      <div className="flex flex-1 items-center justify-center px-6 py-8">
        {awaitingReady ? <ReadyPanel onReady={ready} /> : <PromptCard />}
      </div>

      <footer className="px-4 pb-8">
        <KeyboardView />
      </footer>
    </main>
  )
}

function modeLabel(mode: string): string {
  return mode === 'song'
    ? '♪ Song'
    : mode === 'learn'
      ? '🎓 Learn'
      : '▶ Practice'
}

// The learning loop's readout (§4.4): the chapter, then the batch as chips with
// their live grades. No bar and no goal minutes — the batch is the length, so a
// progress bar would be measuring against a number that doesn't exist, and the
// chips already say how far along it is. `★` stamps on as each combo passes.
function LearningHeader({
  batch,
  chapterTitle,
}: {
  batch: readonly PathComboView[]
  chapterTitle: string | null
}) {
  const passed = batch.filter((combo) => combo.passed).length
  return (
    <>
      <Chip className="px-4 py-2 text-[15px]" tone="default">
        {chapterTitle ?? 'The path'}
      </Chip>
      <div className="flex items-center gap-2">
        {batch.map((combo) => (
          <Chip
            key={combo.key}
            selected={combo.passed}
            tone={combo.passed ? 'default' : 'info'}
            className={cx(
              'px-3 py-1.5 text-sm',
              // A combo with no history at all is drawn dashed: it isn't failing,
              // it simply hasn't been asked yet (§7.5's `new`).
              combo.grade === null && !combo.passed && 'border-dashed',
            )}
          >
            {combo.passed && '★ '}
            {combo.label}
            {combo.grade !== null && (
              <b className={gradeText(combo.grade)}>{combo.grade}</b>
            )}
          </Chip>
        ))}
      </div>
      <span className="text-sm font-semibold tabular-nums text-ink-muted">
        {passed} of {batch.length} passed
      </span>
    </>
  )
}

// The chapter song's readout (§3.3): amber, because amber is the checkpoint's
// one colour, and a countdown to the stamp rather than a loop counter — the
// phrase is the whole task, so what matters is how much of it is left.
function ChapterSongHeader({
  chapterTitle,
  songChapterTitle,
  tempo,
}: {
  chapterTitle: string | null
  songChapterTitle: string | null
  tempo: number
}) {
  const title = songChapterTitle ?? chapterTitle ?? 'Chapter song'
  return (
    <>
      <Chip tone="warn" selected className="px-4 py-2 text-[15px]">
        🎵 {title} song
      </Chip>
      <Chip className="px-3 py-1.5 text-[13px]">♩ = {tempo}</Chip>
      <BarsToStamp />
    </>
  )
}

// How much of the phrase is left before the chapter is stamped. One phrase is
// the progression repeated SONG_LOOPS_PER_PHRASE times (§6.5), so this counts
// bars rather than loops: "3 bars from the stamp" is a finish line, "loop 4 of
// 4" is bookkeeping.
function BarsToStamp() {
  const song = usePractice((s) => s.song)
  if (song === null || song.progression.length === 0) return null
  const perPhrase = song.progression.length * 4
  const played = song.loopIndex * song.progression.length + song.barIndex
  const left = song.countingIn ? perPhrase : Math.max(0, perPhrase - played)
  if (left === 0) return null
  return (
    <span className="text-sm font-semibold text-warn-light">
      {left} bar{left === 1 ? '' : 's'} from the stamp
    </span>
  )
}

// Free practice keeps the v9 readout unchanged (§7.3): a done/length bar, or —
// at ∞, which has no length to fill — today's goal minutes, the one thing still
// pacing an endless session.
function FreePracticeCenter({
  mode,
  done,
  sessionLength,
  todayMinutes,
  goalMinutes,
  unlocked,
  total,
  loopIndex,
  tempo,
}: {
  mode: string
  done: number
  sessionLength: number | null
  todayMinutes: number
  goalMinutes: number
  unlocked: number
  total: number
  loopIndex: number
  tempo: number
}) {
  const counted = mode !== 'song'
  const bounded = sessionLength !== null && sessionLength > 0
  const goalMet = todayMinutes >= goalMinutes
  const pct = bounded
    ? Math.min(100, (100 * done) / (sessionLength ?? 1))
    : Math.min(100, (100 * todayMinutes) / Math.max(1, goalMinutes))

  return (
    <>
      {counted && (
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-track">
          <div
            className={cx(
              'h-full rounded-full',
              bounded || goalMet ? 'bg-primary' : 'bg-info',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {counted && (
        <span className="text-sm font-semibold tabular-nums text-ink-muted">
          {bounded ? `${done} / ${sessionLength}` : done}
        </span>
      )}
      {counted && !bounded && (
        <span className="text-sm font-semibold tabular-nums text-ink-muted">
          {goalMet
            ? '🔥 Streak safe'
            : `🔥 ${Math.floor(todayMinutes)} / ${goalMinutes} min`}
        </span>
      )}
      {mode === 'learn' && (
        <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-muted">
          🔓{' '}
          <b className="text-info-light">
            {unlocked}/{total}
          </b>
        </span>
      )}
      {mode === 'song' && (
        <>
          <Chip className="px-3 py-1.5 text-[13px]">♩ = {tempo}</Chip>
          <Chip className="px-3 py-1.5 text-[13px]">loop {loopIndex + 1}</Chip>
        </>
      )}
    </>
  )
}

// The §7.3 ready gate: a session's first prompt waits here, so the
// time-to-correct it records is the time to *play* the chord, not the time to
// walk up to the keyboard. The whole panel is the tap target (any note answers
// it too, via the store) and the keyboard below stays live for warming up.
function ReadyPanel({ onReady }: { onReady: () => void }) {
  return (
    <button
      type="button"
      onClick={onReady}
      className="flex w-full max-w-2xl flex-col items-center gap-3 rounded-[20px] border-2 border-dashed border-muted-border px-8 py-14 text-center transition-colors hover:border-primary"
    >
      <span className="text-5xl font-extrabold tracking-tight sm:text-6xl">
        Ready?
      </span>
      <span className="text-lg text-ink-muted">
        Tap here or play any note — the timer starts with the first chord.
      </span>
    </button>
  )
}
