// Shared form primitives for the settings screen and the Phase 9 editors.

export function Toggle({
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
        aria-label={label}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-emerald-500"
      />
    </label>
  )
}

export function NumberField({
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
        aria-label={label}
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

export function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
      {label}
      <input
        aria-label={label}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-56 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100 placeholder:text-slate-600"
      />
    </label>
  )
}

// A number input whose empty state means "no constraint" — the voicing
// builder's span fields. The string state belongs to the caller so partial
// input ("1" on the way to "12") never snaps.
export function OptionalNumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
      {label}
      <input
        aria-label={label}
        type="number"
        min={0}
        value={value}
        placeholder="—"
        onChange={(e) => onChange(e.target.value)}
        className="w-24 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-right text-slate-100 placeholder:text-slate-600"
      />
    </label>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-slate-200">
      {label}
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// A toggleable chip (root/chord-type multi-selects in the preset editor).
// Selection is shown by color *and* the leading mark (§6.4's shape rule).
export function Chip({
  label,
  selected,
  onToggle,
}: {
  label: string
  selected: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onToggle}
      className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
        selected
          ? 'border-emerald-500 bg-emerald-950 text-emerald-200'
          : 'border-slate-700 text-slate-400 hover:border-slate-500'
      }`}
    >
      {selected ? '✓ ' : ''}
      {label}
    </button>
  )
}
