import { usePractice } from '../store/practiceStore'

// Transient §5 unlock notification: names the chords a fresh batch just
// opened, floating over the practice view for the same window as the
// unlock chip's flash. Hidden in Song mode like the chip (§6.5 isn't gated).
export function UnlockToast() {
  const justUnlocked = usePractice((s) => s.justUnlocked)
  const labels = usePractice((s) => s.justUnlockedLabels)
  const mode = usePractice((s) => s.mode)

  if (mode === 'song' || !justUnlocked || labels.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-20 flex justify-center">
      <div
        role="status"
        className="rounded-lg border border-emerald-500 bg-slate-800/95 px-4 py-2 text-sm text-emerald-300 shadow-lg"
      >
        🔓 New chord{labels.length === 1 ? '' : 's'} unlocked:{' '}
        <span className="font-semibold">{labels.join(', ')}</span>
      </div>
    </div>
  )
}
