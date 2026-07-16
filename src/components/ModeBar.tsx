import { useState } from 'react'
import { usePractice } from '../store/practiceStore'
import {
  MAX_TIMER_MINUTES,
  TIMER_PRESET_MINUTES,
  type SessionMode,
} from '../practice'

// Top-bar session-mode picker (§7) with the Practice-mode settings beside
// it: the session timer and the worst-chords-only toggle. Learn hides both
// (Learn is untimed and always draws from the whole pool).
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
      </div>
      {mode === 'practice' && (
        <>
          <TimerControl />
          <WorstOnlyToggle />
        </>
      )}
    </div>
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

// The §7 timer setting: off / presets / custom. Picking a duration starts
// the countdown immediately; "off" cancels a running timer without a
// summary. The countdown itself is shown in the prompt area.
function TimerControl() {
  const timerMinutes = usePractice((s) => s.timerMinutes)
  const startTimer = usePractice((s) => s.startTimer)
  const cancelTimer = usePractice((s) => s.cancelTimer)
  const [customOpen, setCustomOpen] = useState(false)
  const [customMinutes, setCustomMinutes] = useState(20)

  const presetValue =
    timerMinutes === null
      ? 'off'
      : TIMER_PRESET_MINUTES.includes(timerMinutes)
        ? String(timerMinutes)
        : 'custom'

  return (
    <div className="flex items-center gap-1.5">
      <select
        className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
        aria-label="Session timer"
        value={customOpen ? 'custom' : presetValue}
        onChange={(e) => {
          const value = e.target.value
          if (value === 'off') {
            setCustomOpen(false)
            cancelTimer()
          } else if (value === 'custom') {
            setCustomOpen(true)
          } else {
            setCustomOpen(false)
            startTimer(Number(value))
          }
        }}
      >
        <option value="off">Timer off</option>
        {TIMER_PRESET_MINUTES.map((minutes) => (
          <option key={minutes} value={minutes}>
            {minutes} min
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {customOpen && (
        <>
          <input
            type="number"
            min={1}
            max={MAX_TIMER_MINUTES}
            value={customMinutes}
            aria-label="Custom timer minutes"
            onChange={(e) => {
              if (Number.isFinite(e.target.valueAsNumber)) {
                setCustomMinutes(e.target.valueAsNumber)
              }
            }}
            className="w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right text-sm text-slate-100"
          />
          <button
            type="button"
            onClick={() => {
              setCustomOpen(false)
              startTimer(customMinutes)
            }}
            className="rounded-md border border-slate-700 px-2 py-1 text-sm text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
          >
            Start
          </button>
        </>
      )}
    </div>
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
