import { useState } from 'react'
import {
  BUILT_IN_VOICING_RULES,
  chordDisplayName,
  formatSpelling,
  getChordType,
  isPatternRule,
  realizeVoicing,
  spellVoicing,
  type BassConstraint,
  type Chord,
  type ChordTypeId,
  type ConstraintVoicingRule,
  type PatternVoicingRule,
  type VoicingRule,
} from '../theory'
import {
  bassConstraintLabel,
  describeVoicingRule,
  EDITOR_BASS_DEGREES,
  EDITOR_MAX_HAND_NOTES,
  EDITOR_MAX_PATTERN_DEGREE,
  newLibraryId,
  parseHandDegrees,
  patternShapeLabel,
} from '../practice'
import { MAX_SPAN_SEMITONES } from '../storage'
import { useLibrary } from '../store/libraryStore'
import { OptionalNumberField, SelectField, TextField } from './fields'

// The §7 voicing builder: two ways to define a VoicingRule.
//
// - Pattern mode (the default for new rules): spell the voicing out as chord
//   degrees per hand — e.g. LH 1-5, RH 1-2-5 — the easiest way to capture an
//   arbitrary two-hand shape (§3.3).
// - Constraint mode: compose bass/span/doubling, for rules that should match
//   *any* voicing satisfying a property rather than one exact shape.
//
// Rules join the shared library and can be referenced by any preset — which
// is also why deletion is blocked while referenced.

type BuilderMode = 'pattern' | 'constraint'

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

const MODE_OPTIONS: readonly { value: BuilderMode; label: string }[] = [
  { value: 'pattern', label: 'Two-hand pattern' },
  { value: 'constraint', label: 'Bass / span / doubling' },
]

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

// The live preview tries the simplest chord that can realize the pattern,
// widening only as needed: a plain triad covers most shapes, maj7 adds the
// 7th, and dom13 (every degree class 1-7 present) satisfies any valid
// degree list at all — so this only ever falls through for a genuinely
// empty pattern.
const PREVIEW_CHORD_TYPE_IDS: readonly ChordTypeId[] = ['maj', 'maj7', 'dom13']

function previewPattern(
  leftHand: readonly number[],
  rightHand: readonly number[],
): { chordName: string; notesText: string } | null {
  const draft: PatternVoicingRule = {
    kind: 'pattern',
    id: 'preview',
    name: 'preview',
    leftHand,
    rightHand,
  }
  for (const typeId of PREVIEW_CHORD_TYPE_IDS) {
    const chord: Chord = { root: 0, type: getChordType(typeId) }
    const midi = realizeVoicing(chord, draft)
    if (midi === null) continue
    const spelled = spellVoicing(chord, midi)
    const noteText = (notes: typeof spelled) =>
      notes.map((n) => `${formatSpelling(n)}${n.octave}`).join(' ')
    const lhText = noteText(spelled.slice(0, leftHand.length))
    const rhText = noteText(spelled.slice(leftHand.length))
    return {
      chordName: chordDisplayName(chord),
      notesText: [lhText, rhText].filter((t) => t !== '').join(' · '),
    }
  }
  return null
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

  const existingPattern = rule && isPatternRule(rule) ? rule : null
  const existingConstraint = rule && !isPatternRule(rule) ? rule : null

  const [mode, setMode] = useState<BuilderMode>(
    rule === null ? 'pattern' : existingPattern ? 'pattern' : 'constraint',
  )
  const [name, setName] = useState(rule?.name ?? '')

  // Pattern-mode state.
  const [leftHandText, setLeftHandText] = useState(
    existingPattern?.leftHand.join('-') ?? '',
  )
  const [rightHandText, setRightHandText] = useState(
    existingPattern?.rightHand.join('-') ?? '',
  )

  // Constraint-mode state.
  const [bass, setBass] = useState<string>(
    existingConstraint ? encodeBass(existingConstraint.bass) : 'any',
  )
  const [spanMin, setSpanMin] = useState(
    existingConstraint?.span?.min?.toString() ?? '',
  )
  const [spanMax, setSpanMax] = useState(
    existingConstraint?.span?.max?.toString() ?? '',
  )
  const [doubling, setDoubling] = useState<ConstraintVoicingRule['doubling']>(
    existingConstraint?.doubling ?? 'allowed',
  )

  const newId = () =>
    rule?.id ??
    newLibraryId(
      'rule',
      new Set([
        ...BUILT_IN_VOICING_RULES.map((r) => r.id),
        ...customRules.map((r) => r.id),
      ]),
    )

  const problems: string[] = []
  let draft: VoicingRule | null = null
  let patternPreview: ReturnType<typeof previewPattern> = null

  if (mode === 'pattern') {
    const leftHand = parseHandDegrees(leftHandText)
    const rightHand = parseHandDegrees(rightHandText)
    if (leftHand === null || rightHand === null) {
      problems.push(`Degrees must be 1–${EDITOR_MAX_PATTERN_DEGREE}`)
    } else {
      if (leftHand.length > EDITOR_MAX_HAND_NOTES) {
        problems.push(`Left hand: at most ${EDITOR_MAX_HAND_NOTES} notes`)
      }
      if (rightHand.length > EDITOR_MAX_HAND_NOTES) {
        problems.push(`Right hand: at most ${EDITOR_MAX_HAND_NOTES} notes`)
      }
      if (leftHand.length === 0 && rightHand.length === 0) {
        problems.push('Add at least one note')
      }
      if (problems.length === 0) {
        patternPreview = previewPattern(leftHand, rightHand)
        draft = {
          kind: 'pattern',
          id: newId(),
          name: name.trim() || patternShapeLabel(leftHand, rightHand),
          leftHand,
          rightHand,
        }
      }
    }
  } else {
    const min = parseSpanField(spanMin)
    const max = parseSpanField(spanMax)
    const spanInvalid =
      min === null ||
      max === null ||
      (min !== undefined && max !== undefined && min > max)

    if (name.trim() === '') problems.push('Name the rule')
    if (min === null || max === null) {
      problems.push(`Span limits must be 0–${MAX_SPAN_SEMITONES} semitones`)
    } else if (spanInvalid) {
      problems.push('Span min can’t exceed span max')
    }

    if (problems.length === 0 && min !== null && max !== null) {
      draft = {
        id: newId(),
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
    }
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
      <SelectField
        label="Rule type"
        value={mode}
        options={MODE_OPTIONS}
        onChange={setMode}
      />

      {mode === 'pattern' ? (
        <>
          <TextField
            label="Name"
            value={name}
            placeholder={
              patternShapeLabel(
                parseHandDegrees(leftHandText) ?? [],
                parseHandDegrees(rightHandText) ?? [],
              ) || 'e.g. 1-5 + 1-2-5'
            }
            onChange={setName}
          />
          <TextField
            label="Left hand"
            value={leftHandText}
            placeholder="e.g. 1-5"
            onChange={setLeftHandText}
          />
          <TextField
            label="Right hand"
            value={rightHandText}
            placeholder="e.g. 1-2-5"
            onChange={setRightHandText}
          />
          <p className="text-xs text-slate-500">
            Degrees from the bottom of each hand: 1 = root, 3 = third, 5 =
            fifth… separate with dashes, spaces, or commas.
          </p>
          {patternPreview && (
            <p className="text-xs text-slate-400">
              Example ({patternPreview.chordName}):{' '}
              <span className="text-slate-200">{patternPreview.notesText}</span>
            </p>
          )}
        </>
      ) : (
        <>
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
        </>
      )}

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
