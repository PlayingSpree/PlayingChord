import type { ReactNode } from 'react'
import { usePractice } from '../store/practiceStore'
import { cx } from './cx'

// The transient in-session notices (DESIGN.md §7.3), stacked in one slot so a
// prompt that both unlocks a batch and lifts a grade doesn't pile two boxes on
// the same spot: the §5 unlock toast naming the chords a fresh batch opened,
// and the §7.3 grade-up toast for a combo whose letter just climbed. Both are
// hidden in Song mode — it isn't unlock-gated (§6.5) and its own chips already
// carry per-bar feedback.
export function Toasts() {
  const justUnlocked = usePractice((s) => s.justUnlocked)
  const labels = usePractice((s) => s.justUnlockedLabels)
  const gradeUp = usePractice((s) => s.gradeUp)
  const mode = usePractice((s) => s.mode)

  if (mode === 'song') return null
  const showUnlock = justUnlocked && labels.length > 0
  if (!showUnlock && gradeUp === null) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-20 flex flex-col items-center gap-2">
      {showUnlock && (
        <Toast tone="unlock">
          🔓 New chord{labels.length === 1 ? '' : 's'} unlocked:{' '}
          <span className="font-extrabold">{labels.join(', ')}</span>
        </Toast>
      )}
      {gradeUp !== null && (
        <Toast tone="grade">
          📈 <span className="font-extrabold">{gradeUp.label}</span> grade up:{' '}
          {gradeUp.from} → <span className="font-extrabold">{gradeUp.to}</span>
        </Toast>
      )}
    </div>
  )
}

// The v9 notice panel: the same chunky bordered card as everything else (§7),
// paired with its own icon so it never reads by color alone (§6.4).
function Toast({
  tone,
  children,
}: {
  tone: 'unlock' | 'grade'
  children: ReactNode
}) {
  return (
    <div
      role="status"
      className={cx(
        'rounded-[14px] border-2 bg-card px-4 py-2 text-sm font-semibold shadow-hard-sm',
        tone === 'unlock'
          ? 'border-info-border text-info-light'
          : 'border-primary text-primary-light',
      )}
    >
      {children}
    </div>
  )
}
