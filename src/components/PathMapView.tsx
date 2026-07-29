import { usePractice } from '../store/practiceStore'
import { RaisedButton } from './ui'
import { cx } from './cx'
import { BatchChips } from './TodayCard'
import type { ChapterRow } from '../practice'

// The path map (DESIGN.md §4.2): every chapter in order, named — done, current,
// locked. It exists so "what's coming" stays answerable, the job the v9 🔒
// disclosure did for one preset.
//
// Nothing here is startable. There is no manual early unlock in v10: calibration
// is the sanctioned fast lane (§5.2), so a locked row is information, not a
// button that would let a player skip the batch that teaches its chords.
export function PathMapView({ onBack }: { onBack: () => void }) {
  const chapterRows = usePractice((s) => s.chapterRows)
  const path = usePractice((s) => s.path)
  const rows = chapterRows()
  const done = rows.filter((r) => r.state === 'done').length
  const stamped = rows.filter((r) => r.songStamped).length

  return (
    <main className="min-h-screen bg-surface px-6 py-6 text-ink">
      <div className="mx-auto flex max-w-5xl flex-col gap-3.5">
        <header className="flex flex-wrap items-center gap-3.5">
          <RaisedButton variant="outline" size="sm" onClick={onBack}>
            ← Home
          </RaisedButton>
          <h1 className="text-2xl font-extrabold">The path</h1>
          <span className="text-sm font-semibold text-ink-muted">
            {path.triadsPassed} of {path.triadsTotal} chords · {done} chapter
            {done === 1 ? '' : 's'} done · {stamped} stamped
          </span>
          <span className="flex-1" />
          <div className="flex gap-3.5 text-[13px] font-semibold text-ink-muted">
            <span>
              <b className="text-primary-light">★</b> passed
            </span>
            <span>
              <b className="text-warn">🎵</b> song stamped
            </span>
            <span>
              <b className="text-ink-faint">🔒</b> locked
            </span>
          </div>
        </header>

        <ol className="flex flex-col gap-2">
          {rows.map((row, index) => (
            <li key={row.chapter.id}>
              <Row row={row} number={index + 1} />
            </li>
          ))}
        </ol>

        {/* The 🎓 footnote (§5.2): a returning player's chapters collapsed on
            load, and being told *why* is what stops that reading as a bug. */}
        {path.triadsPassed > 0 && (
          <p className="mt-2 flex items-center gap-3 rounded-2xl border-2 border-muted-border px-4.5 py-3.5 text-sm font-semibold text-ink-muted">
            <span className="text-lg">🎓</span>
            <span>
              Already play some of these? Every chord you have history for was
              passed on arrival — the path opened at your real frontier.{' '}
              <span className="text-ink-soft">Reset path</span> in Settings.
            </span>
          </p>
        )}
      </div>
    </main>
  )
}

function Row({ row, number }: { row: ChapterRow; number: number }) {
  const current = row.state === 'current'
  return (
    <div
      className={cx(
        'flex flex-col gap-3',
        current
          ? 'rounded-[18px] border-2 border-info bg-info-tint p-4 shadow-hard'
          : row.state === 'done'
            ? 'rounded-2xl border-2 border-muted-border bg-card/60 px-4 py-2.5'
            : 'rounded-2xl border-2 border-dashed border-muted-border px-4 py-2.5',
      )}
    >
      <div className="flex flex-wrap items-center gap-3.5">
        <span
          className={cx(
            'w-7 text-[13px] font-extrabold',
            current ? 'text-info-light' : 'text-ink-muted',
          )}
        >
          {number}
        </span>
        <span
          className={cx(
            'font-extrabold',
            current ? 'text-2xl text-ink' : 'text-[17px] text-ink-soft',
          )}
        >
          {row.chapter.title}
        </span>
        {current && (
          <span className="rounded-[10px] border-2 border-info-border px-2.5 py-0.5 text-xs font-extrabold tracking-[0.06em] text-info-light">
            IN PROGRESS
          </span>
        )}
        {!current && (
          <span className="text-sm font-semibold text-ink-muted">
            {row.chapter.blurb}
          </span>
        )}
        <span className="flex-1" />
        {current ? (
          <span className="text-sm font-semibold text-info-light">
            batch {row.batchIndex + 1} of {row.batchTotal}
          </span>
        ) : row.state === 'done' ? (
          <>
            <span className="text-sm font-extrabold text-warn">
              {row.hasSong ? (row.songStamped ? '🎵' : '') : ''}
            </span>
            {row.hasSong && !row.songStamped && (
              <span className="text-sm font-semibold text-ink-muted">
                no stamp
              </span>
            )}
            <span className="text-sm font-extrabold text-primary-light">
              ★ {row.passedCount}/{row.total}
            </span>
          </>
        ) : (
          <span className="text-sm text-ink-muted">🔒</span>
        )}
      </div>

      {current && (
        <div className="flex flex-wrap items-center gap-2 pl-10">
          <BatchChips batch={row.batch} />
          {row.hasSong && (
            <span className="text-sm font-semibold text-warn-light">
              · 🎵 {row.songStamped ? 'song stamped' : 'song not played yet'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
