import { useState } from 'react'
import { usePractice } from '../store/practiceStore'

// Top-bar unlock chip (§5/§7): how many of the active preset's chords are in
// play. Flashes emerald for a moment when a batch unlocks; hidden in Song
// mode, which draws from the full pool (§6.5). Clicking it expands the
// per-chord breakdown (locked / unlocked-not-yet-passed / passed).
export function UnlockChip() {
  const progress = usePractice((s) => s.progress)
  const justUnlocked = usePractice((s) => s.justUnlocked)
  const mode = usePractice((s) => s.mode)
  const chordPassStatus = usePractice((s) => s.chordPassStatus)
  const [open, setOpen] = useState(false)

  if (mode === 'song') return null

  const complete = progress.unlocked >= progress.total

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
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
      </button>
      {open && (
        <>
          {/* Backdrop: closes the panel on an outside click. */}
          <button
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute left-0 top-full z-20 mt-1 max-h-80 w-56 overflow-y-auto rounded-md border border-slate-700 bg-slate-800 p-1.5 shadow-lg">
            {chordPassStatus().map((chord) => (
              <div
                key={chord.key}
                className={`flex items-center justify-between rounded px-2 py-1 text-sm ${
                  chord.unlocked ? 'text-slate-200' : 'text-slate-600'
                }`}
              >
                <span>{chord.label}</span>
                <span>
                  {chord.passed ? (
                    <span className="text-emerald-400">✓ Passed</span>
                  ) : chord.unlocked ? (
                    <span className="text-slate-400">Learning</span>
                  ) : (
                    <span>🔒</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
