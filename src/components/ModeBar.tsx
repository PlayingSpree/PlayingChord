import { useState } from 'react'
import { usePractice } from '../store/practiceStore'
import { settingsStore, useSettings } from '../store/settingsStore'
import {
  MAX_SONG_TEMPO_BPM,
  MIN_SONG_TEMPO_BPM,
  SONG_CHORD_COUNTS,
  type SessionMode,
} from '../practice'

// Top-bar session-mode picker (§7) with the mode-specific settings beside
// it: Learn gets the not-passed-only toggle; Practice gets the worst-chords-
// only toggle; Song (§6.5) gets tempo, progression length and the
// show-example toggle. (Session length lives in the sheet now, §7.2.)
export function ModeBar() {
  const mode = usePractice((s) => s.mode)
  const setMode = usePractice((s) => s.setMode)

  return (
    <div className="flex items-center gap-2">
      <div
        role="group"
        aria-label="Session mode"
        className="flex overflow-hidden rounded-md border border-slate-700 text-sm"
      >
        <ModeButton mode="learn" active={mode} onSelect={setMode}>
          Learn
        </ModeButton>
        <ModeButton mode="practice" active={mode} onSelect={setMode}>
          Practice
        </ModeButton>
        <ModeButton mode="song" active={mode} onSelect={setMode}>
          Song
        </ModeButton>
      </div>
      {mode === 'learn' && <NotPassedOnlyToggle />}
      {mode === 'practice' && <WorstOnlyToggle />}
      {mode === 'song' && <SongControls />}
    </div>
  )
}

// Song-mode settings (§6.5/§7): persisted (tempo and length are skill-level
// preferences) but set here beside the mode picker, not the settings panel.
// Tempo applies from the next beat, chord count from the next progression,
// show-example is pure display — no store action needed.
function SongControls() {
  const tempo = useSettings((s) => s.settings.songTempoBpm)
  const chordCount = useSettings((s) => s.settings.songChordCount)
  const showExample = useSettings((s) => s.settings.songShowExample)
  const update = settingsStore.getState().update
  // Committing on blur, not per keystroke: the sanitizer clamps to
  // [40, 140], which would rewrite "1" to 40 mid-way through typing "100".
  const [tempoDraft, setTempoDraft] = useState<string | null>(null)

  return (
    <>
      <label className="flex items-center gap-1.5 text-sm text-slate-300">
        <input
          type="number"
          min={MIN_SONG_TEMPO_BPM}
          max={MAX_SONG_TEMPO_BPM}
          value={tempoDraft ?? tempo}
          aria-label="Tempo in beats per minute"
          onChange={(e) => setTempoDraft(e.target.value)}
          onBlur={() => {
            if (tempoDraft !== null && tempoDraft !== '') {
              update({ songTempoBpm: Number(tempoDraft) })
            }
            setTempoDraft(null)
          }}
          className="w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right text-sm text-slate-100"
        />
        BPM
      </label>
      <select
        className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
        aria-label="Chords per progression"
        value={chordCount}
        onChange={(e) => update({ songChordCount: Number(e.target.value) })}
      >
        {SONG_CHORD_COUNTS.map((count) => (
          <option key={count} value={count}>
            {count} chords
          </option>
        ))}
      </select>
      <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-300">
        <input
          type="checkbox"
          checked={showExample}
          onChange={(e) => update({ songShowExample: e.target.checked })}
          className="h-4 w-4 accent-sky-500"
        />
        Show example
      </label>
    </>
  )
}

function ModeButton({
  mode,
  active,
  onSelect,
  children,
}: {
  mode: SessionMode
  active: SessionMode
  onSelect: (mode: SessionMode) => void
  children: string
}) {
  const isActive = mode === active
  return (
    <button
      type="button"
      aria-pressed={isActive}
      onClick={() => onSelect(mode)}
      className={`px-2.5 py-1 transition-colors ${
        isActive
          ? 'bg-slate-700 font-medium text-slate-100'
          : 'text-slate-400 hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  )
}

// The §5.1/§7 Learn-mode setting: narrows generation to unlocked chords not
// yet passed. Disabled once every unlocked chord is passed — nothing
// left to narrow to (mirrors WorstOnlyToggle's empty-list disable below).
function NotPassedOnlyToggle() {
  const notPassedOnly = usePractice((s) => s.notPassedOnly)
  const setNotPassedOnly = usePractice((s) => s.setNotPassedOnly)
  const progress = usePractice((s) => s.progress)
  const disabled = progress.unlocked === progress.passed && !notPassedOnly

  return (
    <label
      className={`flex items-center gap-1.5 text-sm ${
        disabled
          ? 'cursor-not-allowed text-slate-600'
          : 'cursor-pointer text-slate-300'
      }`}
      title={disabled ? 'No unpassed chords in this preset yet' : undefined}
    >
      <input
        type="checkbox"
        checked={notPassedOnly}
        disabled={disabled}
        onChange={(e) => setNotPassedOnly(e.target.checked)}
        className="h-4 w-4 accent-amber-500"
      />
      Not passed only
    </label>
  )
}

function WorstOnlyToggle() {
  const worstOnly = usePractice((s) => s.worstOnly)
  const setWorstOnly = usePractice((s) => s.setWorstOnly)
  const worstChords = usePractice((s) => s.worstChords)
  // Nothing qualifies as "worst" until something has been missed (§5).
  const disabled = worstChords.length === 0 && !worstOnly

  return (
    <label
      className={`flex items-center gap-1.5 text-sm ${
        disabled
          ? 'cursor-not-allowed text-slate-600'
          : 'cursor-pointer text-slate-300'
      }`}
      title={disabled ? 'No missed chords in this preset yet' : undefined}
    >
      <input
        type="checkbox"
        checked={worstOnly}
        disabled={disabled}
        onChange={(e) => setWorstOnly(e.target.checked)}
        className="h-4 w-4 accent-amber-500"
      />
      Worst only
    </label>
  )
}
