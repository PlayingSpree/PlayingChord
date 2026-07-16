import { useState } from 'react'
import { useSettings } from '../store/settingsStore'
import { practiceStore } from '../store/practiceStore'
import { MAX_DAILY_GOAL_MINUTES, MAX_DELAY_MS } from '../practice'

// Minimal settings popover (DESIGN.md §6.2/§6.3, §7): matcher toggles, the
// two delays, and the daily goal minutes. The full settings screen (presets,
// voicing builder, staff, chime) lands in Phase 9.
export function SettingsPanel() {
  const [open, setOpen] = useState(false)
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Settings"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`rounded-md border px-2.5 py-1 text-sm transition-colors ${
          open
            ? 'border-slate-500 bg-slate-800 text-slate-100'
            : 'border-slate-700 text-slate-300 hover:border-slate-500'
        }`}
      >
        ⚙ Settings
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded-lg border border-slate-700 bg-slate-950 p-4 text-left shadow-xl">
          <div className="flex flex-col gap-3">
            <Toggle
              label="Allow octave doubling"
              checked={settings.allowOctaveDoubling}
              onChange={(v) => update({ allowOctaveDoubling: v })}
            />
            <Toggle
              label="Strict extra notes"
              checked={settings.strictExtraNotes}
              onChange={(v) => update({ strictExtraNotes: v })}
            />
            <DelayField
              label="Judgment delay (ms)"
              value={settings.judgmentDelayMs}
              onChange={(v) => update({ judgmentDelayMs: v })}
            />
            <DelayField
              label="Auto-advance delay (ms)"
              value={settings.autoAdvanceMs}
              onChange={(v) => update({ autoAdvanceMs: v })}
            />
            <NumberField
              label="Daily goal (minutes)"
              value={settings.dailyGoalMinutes}
              min={1}
              max={MAX_DAILY_GOAL_MINUTES}
              step={5}
              onChange={(v) => {
                update({ dailyGoalMinutes: v })
                // Streak/goal state is derived against the current goal.
                practiceStore.getState().refreshGoal()
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-slate-200">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-emerald-500"
      />
    </label>
  )
}

function DelayField(props: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return <NumberField {...props} min={0} max={MAX_DELAY_MS} step={50} />
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          // Ignore transient empty/invalid input; the store sanitizes anyway.
          if (Number.isFinite(e.target.valueAsNumber)) {
            onChange(e.target.valueAsNumber)
          }
        }}
        className="w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right text-slate-100"
      />
    </label>
  )
}
