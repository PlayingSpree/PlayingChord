import { usePractice } from '../store/practiceStore'
import { Card, RaisedButton, SectionLabel } from './ui'
import { cx } from './cx'
import { gradeText } from './grades'
import type { PathComboView } from '../practice'
import type { PathSnapshot } from '../store/practiceStore'

// Home's Today card (DESIGN.md §4.1): the path's face and the one primary
// button. Its four states are decided in the store (todayCard), first match
// wins, so what the player sees is the next right thing rather than a menu.
//
// One button, but not a lock: the other steps stay reachable underneath, below a
// divider rather than beside it as equals — a player who wants to skip to the
// song can, and the layout says which choice is the default without removing the
// others.

export type StartIntent = 'path-learn' | 'repertoire' | 'chapter-song' | 'free'

export function TodayCard({
  onStart,
  onFreePractice,
}: {
  onStart: (intent: StartIntent, chapterId?: string) => void
  onFreePractice: () => void
}) {
  const path = usePractice((s) => s.path)
  const goal = usePractice((s) => s.goal)
  const { today } = path

  // State 3 recolours the whole card amber rather than adding a badge, so the
  // day's step reads from across the room — and 🎵 is the only place amber acts.
  const amber = today.kind === 'song'
  const green = today.kind === 'done'

  return (
    <Card
      className={cx(
        'flex flex-col gap-3.5 p-6',
        amber && 'border-warn-border bg-warn-tint',
        green && 'border-primary-shadow bg-primary-tint',
      )}
    >
      <div className="flex items-baseline gap-2.5">
        <SectionLabel className={amber ? 'text-warn-light' : undefined}>
          Today
        </SectionLabel>
        <span
          className={cx(
            'text-[13px] font-semibold',
            amber ? 'text-warn-light' : 'text-ink-muted',
          )}
        >
          {positionLine(path)}
        </span>
      </div>

      {today.kind === 'batch' && (
        <>
          <Headline>
            Learn {joinLabels(today.batch.map((c) => c.label))}
          </Headline>
          <BatchChips batch={path.batch} />
          <span className="text-sm font-semibold text-ink-muted">
            Both to a D or better and the chapter opens
          </span>
          <RaisedButton
            variant="primary"
            size="lg"
            className="mt-0.5 justify-center py-4 text-2xl"
            onClick={() => onStart('path-learn')}
          >
            {today.batch.length === 2 ? 'Learn these two' : 'Learn these'} ▶
          </RaisedButton>
          <Footnote>
            Ends itself once they all pass — usually 3–5 min. Old chords are
            mixed in as you go.
          </Footnote>
        </>
      )}

      {today.kind === 'practice' && (
        <>
          <div className="flex items-center gap-4">
            <div className="flex flex-1 flex-col gap-0.5">
              <Headline>Practice</Headline>
              <span className="text-[15px] font-semibold text-ink-muted">
                All {today.comboCount} learned chord
                {today.comboCount === 1 ? '' : 's'}, worst first
              </span>
            </div>
          </div>
          <RaisedButton
            variant="primary"
            size="lg"
            className="justify-center py-4 text-2xl"
            onClick={() => onStart('repertoire')}
          >
            Practice ▶
          </RaisedButton>
          <Footnote>
            Runs until you end it — {Math.floor(goal.todayMinutes)} min in
            today.
          </Footnote>
        </>
      )}

      {today.kind === 'song' && (
        <>
          <Headline>
            🎵 Play the song in {keyName(today.chapter.title)}
          </Headline>
          <span className="text-[15px] font-semibold text-warn-light">
            {today.progression.map(romanish).join(' · ')} — chords you already
            own, in a new context. One full phrase stamps the chapter.
          </span>
          <RaisedButton
            variant="warn"
            size="lg"
            className="justify-center py-4 text-2xl"
            onClick={() => onStart('chapter-song', today.chapter.id)}
          >
            Start the song ▶
          </RaisedButton>
        </>
      )}

      {today.kind === 'done' && (
        <>
          <Headline>🔥 Streak safe — day {goal.streak}</Headline>
          <span className="text-[15px] font-semibold text-primary-light">
            Goal met and nothing owed. The session just doesn’t stop when you
            don’t want it to.
          </span>
          <RaisedButton
            variant="primary-outline"
            size="lg"
            className="justify-center py-4 text-2xl"
            onClick={() => onStart('repertoire')}
          >
            Extra practice ▶
          </RaisedButton>
        </>
      )}

      <div
        className={cx('h-0.5', amber || green ? 'bg-black/20' : 'bg-track')}
      />
      <Secondary
        today={today.kind}
        path={path}
        onStart={onStart}
        onFreePractice={onFreePractice}
      />
    </Card>
  )
}

// The steps this card is *not* leading with, so none of them is unreachable
// (§4.1). Deliberately omits whichever one is already the primary button.
function Secondary({
  today,
  path,
  onStart,
  onFreePractice,
}: {
  today: PathSnapshot['today']['kind']
  path: PathSnapshot
  onStart: (intent: StartIntent, chapterId?: string) => void
  onFreePractice: () => void
}) {
  const canPractice = path.repertoire.some((combo) => !combo.setAside)
  return (
    <div className="flex flex-wrap gap-2.5">
      {today !== 'practice' && today !== 'done' && canPractice && (
        <RaisedButton
          variant="outline"
          size="sm"
          className="flex-1 justify-start"
          onClick={() => onStart('repertoire')}
        >
          ▶ Practice repertoire
        </RaisedButton>
      )}
      {today !== 'song' && path.songChapterId !== null && (
        <RaisedButton
          variant="outline"
          size="sm"
          className="flex-1 justify-start border-warn-border text-warn"
          onClick={() => onStart('chapter-song', path.songChapterId ?? '')}
        >
          🎵 Song in {keyName(path.songChapterTitle)}
          <span className="ml-auto text-xs font-semibold text-warn-light">
            not stamped
          </span>
        </RaisedButton>
      )}
      <RaisedButton
        variant="outline"
        size="sm"
        className="flex-1 justify-start"
        onClick={onFreePractice}
      >
        Free practice
      </RaisedButton>
    </div>
  )
}

// The batch as chips with live grades — the same data and the same names the
// Stage shows (§4.4), so starting the session doesn't change the vocabulary.
export function BatchChips({ batch }: { batch: readonly PathComboView[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {batch.map((combo) => (
        <span
          key={combo.key}
          className={cx(
            'inline-flex items-center gap-2 rounded-xl border-2 px-3 py-1.5 text-[15px] font-extrabold',
            combo.passed
              ? 'border-primary-shadow bg-primary-tint text-primary-light'
              : combo.grade === null
                ? 'border-dashed border-info-border bg-info-tint text-info-light'
                : 'border-muted-border bg-surface text-ink',
          )}
        >
          {combo.passed && '★'}
          {combo.label}
          {combo.grade === null ? (
            <span className="text-sm font-semibold text-info-light">new</span>
          ) : (
            <b className={gradeText(combo.grade)}>{combo.grade}</b>
          )}
        </span>
      ))}
    </div>
  )
}

function Headline({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-4xl font-extrabold leading-none tracking-tight">
      {children}
    </span>
  )
}

function Footnote({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-center text-sm font-semibold text-ink-muted">
      {children}
    </span>
  )
}

// "Chapter 3 of 16 · Key of G · 8/24 chords" — where the player is, in one line.
// The chord count is *triads*, distinct: C in two inversions is two combos and
// one chord, and the repertoire row counts combos, so the two are labelled
// differently on purpose (§4.1).
function positionLine(path: PathSnapshot): string {
  const parts: string[] = []
  if (path.complete) {
    parts.push('Path complete')
  } else {
    parts.push(`Chapter ${path.chapterNumber} of ${path.chapterTotal}`)
    if (path.chapterTitle !== null) parts.push(path.chapterTitle)
  }
  parts.push(`${path.triadsPassed}/${path.triadsTotal} chords`)
  return parts.join(' · ')
}

// "Key of G" → "G", for a headline that already says the word "song".
function keyName(title: string | null): string {
  return title?.replace(/^Key of /, '') ?? 'your key'
}

function joinLabels(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? 'the next chords'
  return `${labels.slice(0, -1).join(', ')} & ${labels[labels.length - 1]}`
}

// The chord's own name, which is what the player reads on the Stage — the Roman
// numeral belongs to the progression display, not to a one-line summary.
function romanish(chord: { root: number; typeId: string }): string {
  const NAMES = [
    'C',
    'D♭',
    'D',
    'E♭',
    'E',
    'F',
    'G♭',
    'G',
    'A♭',
    'A',
    'B♭',
    'B',
  ]
  return `${NAMES[chord.root] ?? '?'}${chord.typeId === 'min' ? 'm' : ''}`
}
