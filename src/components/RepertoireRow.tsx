import { useState } from 'react'
import { usePractice } from '../store/practiceStore'
import { Card, RaisedButton, SectionLabel } from './ui'
import { cx } from './cx'
import { gradeText } from './grades'
import type { DisplayGrade } from '../practice'

// Home's repertoire row (DESIGN.md §4.1): every chord the path has passed, with
// its live grade. What the v9 "In play" row did, keyed per combo now, because
// grades always were — C in root position and C with a left-hand bass are two
// records and the row has to be able to say so.
//
// The count here is *combos*, and the Today card's is triads. They are labelled
// differently rather than reconciled: one number meaning two things would be
// worse than two numbers meaning one each.
export function RepertoireRow({ onPathMap }: { onPathMap: () => void }) {
  const path = usePractice((s) => s.path)
  const setAside = usePractice((s) => s.setPathComboAside)
  const openCombo = usePractice((s) => s.openPathCombo)
  const canSetAside = usePractice((s) => s.canSetPathComboAside)
  // Behind a toggle rather than always live: the row is read every session and
  // edited rarely, so a chip that benched a chord on a stray click would be a
  // trap in a row you scan.
  const [editing, setEditing] = useState(false)

  const inPlay = path.repertoire.filter((combo) => !combo.setAside)
  const benched = path.repertoire.filter((combo) => combo.setAside)
  const chaptersAhead = path.chapterTotal - path.chapterNumber + 1

  if (path.repertoire.length === 0) {
    return (
      <Card className="flex items-center gap-3 p-5">
        <SectionLabel>Repertoire</SectionLabel>
        <span className="text-sm font-semibold text-ink-muted">
          Nothing learned yet — the first batch fills this row.
        </span>
        <span className="flex-1" />
        <RaisedButton variant="outline" size="sm" onClick={onPathMap}>
          🗺 See the path →
        </RaisedButton>
      </Card>
    )
  }

  return (
    <Card className="flex flex-col gap-2.5 p-5">
      <div className="flex items-baseline gap-2.5">
        <SectionLabel>Repertoire</SectionLabel>
        <span className="text-[13px] font-semibold text-ink-muted">
          {inPlay.length} learned · practice deals from all of them
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-pressed={editing}
          onClick={() => setEditing(!editing)}
          className="text-[13px] font-semibold text-ink-muted hover:text-ink-soft"
        >
          {editing ? 'Done' : '✎ Edit pool'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {inPlay.map((combo) => (
          <Chip
            key={combo.key}
            label={combo.label}
            grade={combo.grade}
            action={
              editing && canSetAside(combo.key)
                ? { glyph: '✕', run: () => setAside(combo.key) }
                : undefined
            }
          />
        ))}
        {/* A benched combo keeps its grade and stays visible: the debt is carried
            in the open, because a chord you can't see is a chord you forget you
            put down (§5.2). */}
        {benched.map((combo) => (
          <Chip
            key={combo.key}
            label={combo.label}
            grade={combo.grade}
            dimmed
            action={
              editing
                ? { glyph: '↩', run: () => openCombo(combo.key) }
                : undefined
            }
          />
        ))}
        {/* The v9 🔒 disclosure named the locked chords; the path map does that
            job better and for all 16 chapters, so this navigates instead of
            expanding (§4.2). Nothing here is startable. */}
        {!path.complete && (
          <RaisedButton variant="outline" size="sm" onClick={onPathMap}>
            🔒 {chaptersAhead} chapter{chaptersAhead === 1 ? '' : 's'} ahead →
          </RaisedButton>
        )}
      </div>
    </Card>
  )
}

function Chip({
  label,
  grade,
  dimmed = false,
  action,
}: {
  label: string
  grade: DisplayGrade | null
  dimmed?: boolean
  action?: { glyph: string; run: () => void }
}) {
  const body = (
    <>
      {dimmed && '💤 '}
      {label}
      {grade !== null && <b className={gradeText(grade)}>{grade}</b>}
      {action && <span className="text-ink-muted">{action.glyph}</span>}
    </>
  )
  const classes = cx(
    'inline-flex items-center gap-2 rounded-xl border-2 px-3 py-1.5 text-sm font-extrabold',
    dimmed
      ? 'border-dashed border-muted-border text-ink-faint'
      : 'border-muted-border bg-surface text-ink',
  )
  if (action) {
    return (
      <button
        type="button"
        onClick={action.run}
        aria-label={`${dimmed ? 'Bring back' : 'Set aside'} ${label}`}
        className={classes}
      >
        {body}
      </button>
    )
  }
  return <span className={classes}>{body}</span>
}
