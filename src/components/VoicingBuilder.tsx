import { useState } from 'react'
import {
  BUILT_IN_VOICING_RULES,
  type BassConstraint,
  type VoicingRule,
} from '../theory'
import {
  bassConstraintLabel,
  describeVoicingRule,
  EDITOR_BASS_DEGREES,
  newLibraryId,
} from '../practice'
import { MAX_SPAN_SEMITONES } from '../storage'
import { useLibrary } from '../store/libraryStore'
import { OptionalNumberField, SelectField, TextField } from './fields'

// The §7 voicing builder: compose bass/span/doubling into a named
// VoicingRule. Rules join the shared library and can be referenced by any
// preset — which is also why deletion is blocked while referenced.

const BASS_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'any', label: bassConstraintLabel({ kind: 'any' }) },
  ...EDITOR_BASS_DEGREES.map((degree) => ({
    value: String(degree),
    label: bassConstraintLabel({ kind: 'chordTone', degree }),
  })),
]

const DOUBLING_OPTIONS = [
  { value: 'allowed', label: 'Allowed' },
  { value: 'exact', label: 'Exact (one note per tone)' },
] as const

function encodeBass(bass: BassConstraint): string {
  if (bass.kind === 'any') return 'any'
  const choice = String(bass.degree)
  return BASS_OPTIONS.some((o) => o.value === choice) ? choice : 'any'
}

function decodeBass(choice: string): BassConstraint {
  return choice === 'any'
    ? { kind: 'any' }
    : { kind: 'chordTone', degree: Number(choice) }
}

// Empty = no constraint; otherwise a whole number of semitones.
function parseSpanField(raw: string): number | undefined | null {
  if (raw.trim() === '') return undefined
  const value = Number(raw)
  return Number.isInteger(value) && value >= 0 && value <= MAX_SPAN_SEMITONES
    ? value
    : null // invalid — blocks saving
}

export function VoicingBuilder({
  rule,
  onClose,
}: {
  rule: VoicingRule | null // null = creating a new rule
  onClose: () => void
}) {
  const customRules = useLibrary((s) => s.customRules)
  const customPresets = useLibrary((s) => s.customPresets)
  const saveRule = useLibrary((s) => s.saveRule)
  const deleteRule = useLibrary((s) => s.deleteRule)

  const [name, setName] = useState(rule?.name ?? '')
  const [bass, setBass] = useState<string>(rule ? encodeBass(rule.bass) : 'any')
  const [spanMin, setSpanMin] = useState(rule?.span?.min?.toString() ?? '')
  const [spanMax, setSpanMax] = useState(rule?.span?.max?.toString() ?? '')
  const [doubling, setDoubling] = useState<VoicingRule['doubling']>(
    rule?.doubling ?? 'allowed',
  )

  const min = parseSpanField(spanMin)
  const max = parseSpanField(spanMax)
  const spanInvalid =
    min === null ||
    max === null ||
    (min !== undefined && max !== undefined && min > max)

  const problems: string[] = []
  if (name.trim() === '') problems.push('Name the rule')
  if (min === null || max === null) {
    problems.push(`Span limits must be 0–${MAX_SPAN_SEMITONES} semitones`)
  } else if (spanInvalid) {
    problems.push('Span min can’t exceed span max')
  }

  const draft: VoicingRule | null =
    problems.length > 0 || min === null || max === null
      ? null
      : {
          id:
            rule?.id ??
            newLibraryId(
              'rule',
              new Set([
                ...BUILT_IN_VOICING_RULES.map((r) => r.id),
                ...customRules.map((r) => r.id),
              ]),
            ),
          name: name.trim(),
          bass: decodeBass(bass),
          ...(min !== undefined || max !== undefined
            ? {
                span: {
                  ...(min !== undefined ? { min } : {}),
                  ...(max !== undefined ? { max } : {}),
                },
              }
            : {}),
          doubling,
        }

  // Deletion is blocked while any custom preset references the rule (§4).
  const referencedBy =
    rule === null
      ? []
      : customPresets.filter((p) => p.voicingIds.includes(rule.id))

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-950 p-4">
      <h4 className="text-sm font-semibold text-slate-100">
        {rule ? `Edit “${rule.name}”` : 'New voicing rule'}
      </h4>
      <TextField
        label="Name"
        value={name}
        placeholder="e.g. Wide root position"
        onChange={setName}
      />
      <SelectField
        label="Bass note"
        value={bass}
        options={BASS_OPTIONS}
        onChange={setBass}
      />
      <OptionalNumberField
        label="Span min (semitones)"
        value={spanMin}
        onChange={setSpanMin}
      />
      <OptionalNumberField
        label="Span max (semitones)"
        value={spanMax}
        onChange={setSpanMax}
      />
      <SelectField
        label="Octave doubling"
        value={doubling}
        options={DOUBLING_OPTIONS}
        onChange={setDoubling}
      />

      {draft ? (
        <p className="text-xs text-slate-400">{describeVoicingRule(draft)}</p>
      ) : (
        <p className="text-xs text-amber-400">⚠ {problems.join(' · ')}</p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={draft === null}
          onClick={() => {
            if (draft && saveRule(draft)) onClose()
          }}
          className="rounded-md bg-emerald-700 px-3 py-1 text-sm font-medium text-emerald-50 transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
        >
          Save rule
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-300 transition-colors hover:border-slate-500"
        >
          Cancel
        </button>
        {rule && (
          <button
            type="button"
            disabled={referencedBy.length > 0}
            title={
              referencedBy.length > 0
                ? `Used by ${referencedBy.map((p) => p.name).join(', ')}`
                : undefined
            }
            onClick={() => {
              if (deleteRule(rule.id)) onClose()
            }}
            className="ml-auto rounded-md border border-rose-900 px-3 py-1 text-sm text-rose-400 transition-colors hover:border-rose-600 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600"
          >
            Delete
          </button>
        )}
      </div>
      {rule && referencedBy.length > 0 && (
        <p className="text-xs text-slate-500">
          Can’t delete: used by {referencedBy.map((p) => p.name).join(', ')}.
        </p>
      )}
    </div>
  )
}
