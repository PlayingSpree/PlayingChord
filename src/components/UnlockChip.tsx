import { usePractice } from '../store/practiceStore'

// Top-bar unlock chip (§5/§7): how many of the active preset's chords are in
// play. Flashes emerald for a moment when a batch unlocks; hidden in Song
// mode, which draws from the full pool (§6.5).
export function UnlockChip() {
  const progress = usePractice((s) => s.progress)
  const justUnlocked = usePractice((s) => s.justUnlocked)
  const mode = usePractice((s) => s.mode)

  if (mode === 'song') return null

  const complete = progress.unlocked >= progress.total
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-2.5 py-1 text-sm transition-colors ${
        justUnlocked ? 'border-emerald-500' : 'border-slate-700'
      }`}
      title={
        complete
          ? `All ${progress.total} chords of this preset are unlocked`
          : `${progress.unlocked} of ${progress.total} chords unlocked — a fast first-try on every unlocked chord opens more`
      }
    >
      <span className="text-slate-300">🔓</span>
      <span
        className={
          justUnlocked || complete
            ? 'font-medium text-emerald-400'
            : 'text-slate-400'
        }
      >
        {complete && '✓ '}
        {progress.unlocked}/{progress.total}
      </span>
    </div>
  )
}
