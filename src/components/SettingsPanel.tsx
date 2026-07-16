import { useState } from 'react'
import { useSettings } from '../store/settingsStore'
import { MAX_DELAY_MS } from '../practice'

// Minimal settings popover for the Phase 4 knobs (DESIGN.md §6.2/§6.3):
// matcher toggles + the two delays. The full settings screen (presets,
// voicing builder, staff, chime, goals) lands in Phase 9.
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

function DelayField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
      {label}
      <input
        type="number"
        min={0}
        max={MAX_DELAY_MS}
        step={50}
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
