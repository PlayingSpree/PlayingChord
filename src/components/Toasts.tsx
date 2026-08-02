import type { ReactNode } from 'react'
import { usePractice } from '../store/practiceStore'
import { MODE_POLICY } from '../practice'
import { cx } from './cx'

// The transient in-session notice (DESIGN.md §7.3): the §5 unlock toast naming
// the chords a fresh batch opened. Hidden in Song mode, which isn't
// unlock-gated (§6.5). The grade-up notice used to share this slot on a timer
// of its own; it now rides the ✔ flash under the feedback pill (§7.3), where
// the rep that earned it is still on screen.
export function Toasts() {
  const justUnlocked = usePractice((s) => s.justUnlocked)
  const labels = usePractice((s) => s.justUnlockedLabels)
  const mode = usePractice((s) => s.mode)

  if (MODE_POLICY[mode].clockPaced) return null
  if (!justUnlocked || labels.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-20 flex flex-col items-center gap-2">
      <Toast tone="unlock">
        🔓 New chord{labels.length === 1 ? '' : 's'} unlocked:{' '}
        <span className="font-extrabold">{labels.join(', ')}</span>
      </Toast>
    </div>
  )
}

// The v9 notice panel: the same chunky bordered card as everything else (§7),
// paired with its own icon so it never reads by color alone (§6.4).
function Toast({ tone, children }: { tone: 'unlock'; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cx(
        'rounded-[14px] border-2 bg-card px-4 py-2 text-sm font-semibold shadow-hard-sm',
        tone === 'unlock' && 'border-info-border text-info-light',
      )}
    >
      {children}
    </div>
  )
}
