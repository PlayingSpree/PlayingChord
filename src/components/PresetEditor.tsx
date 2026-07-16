import { useState } from 'react'
import {
  ALL_PITCH_CLASSES,
  CHORD_TYPES,
  formatSpelling,
  keyDisplayName,
  spellRoot,
  voicingLibrary,
  type ChordTypeId,
  type PitchClass,
} from '../theory'
import {
  builtInPresets,
  expandPreset,
  newLibraryId,
  presetWarnings,
  type ChordPool,
  type PoolChord,
  type Preset,
} from '../practice'
import { useLibrary } from '../store/libraryStore'
import { Chip, SelectField, TextField } from './fields'

// The §4/§7 preset editor: name + chord pool + voicing-rule references,
// with live rule-compatibility warnings. Unsatisfiable combos are dropped
// at expansion, so warned presets still drill their playable part — only a
// preset with *nothing* drillable can't be saved.

const POOL_OPTIONS = [
  { value: 'product', label: 'Roots × chord types' },
  { value: 'explicit', label: 'Exact chord list' },
  { value: 'diatonic', label: 'Diatonic triads in a key' },
] as const

const ROOT_OPTIONS = ALL_PITCH_CLASSES.map((pc) => ({
  value: String(pc),
  label: formatSpelling(spellRoot(pc)),
}))

const TYPE_OPTIONS = CHORD_TYPES.map((type) => ({
  value: type.id as string,
  label: type.name,
}))

const KEY_OPTIONS = ALL_PITCH_CLASSES.map((pc) => ({
  value: String(pc),
  label: keyDisplayName(pc),
}))

const BUILT_IN_PRESET_IDS = builtInPresets().map((p) => p.id)

export function PresetEditor({
  preset,
  onClose,
}: {
  preset: Preset | null // null = creating a new preset
  onClose: () => void
}) {
  const customRules = useLibrary((s) => s.customRules)
  const customPresets = useLibrary((s) => s.customPresets)
  const savePreset = useLibrary((s) => s.savePreset)
  const deletePreset = useLibrary((s) => s.deletePreset)
  const library = voicingLibrary(customRules)

  const pool = preset?.pool
  const [name, setName] = useState(preset?.name ?? '')
  const [kind, setKind] = useState<ChordPool['kind']>(pool?.kind ?? 'product')
  const [roots, setRoots] = useState<readonly PitchClass[]>(
    pool?.kind === 'product' ? pool.roots : ALL_PITCH_CLASSES,
  )
  const [chordTypes, setChordTypes] = useState<readonly ChordTypeId[]>(
    pool?.kind === 'product' ? pool.chordTypes : ['maj'],
  )
  const [explicit, setExplicit] = useState<readonly PoolChord[]>(
    pool?.kind === 'explicit' ? pool.chords : [{ root: 0, typeId: 'maj' }],
  )
  const [diatonicKey, setDiatonicKey] = useState<PitchClass>(
    pool?.kind === 'diatonic' ? pool.key : 0,
  )
  const [voicingIds, setVoicingIds] = useState<readonly string[]>(
    preset?.voicingIds ?? ['any'],
  )

  const draftPool: ChordPool =
    kind === 'product'
      ? { kind, roots, chordTypes }
      : kind === 'explicit'
        ? { kind, chords: explicit }
        : { kind, key: diatonicKey }
  const draft: Preset = {
    id:
      preset?.id ??
      newLibraryId(
        'preset',
        new Set([...BUILT_IN_PRESET_IDS, ...customPresets.map((p) => p.id)]),
      ),
    name: name.trim(),
    pool: draftPool,
    voicingIds,
  }

  const warnings = presetWarnings(draft, library)
  const comboCount = expandPreset(draft, library).combos.length

  const problems: string[] = []
  if (draft.name === '') problems.push('Name the preset')
  if (kind === 'product' && roots.length === 0) problems.push('Pick a root')
  if (kind === 'product' && chordTypes.length === 0) {
    problems.push('Pick a chord type')
  }
  if (kind === 'explicit' && explicit.length === 0) {
    problems.push('Add a chord')
  }
  if (voicingIds.length === 0) problems.push('Pick a voicing rule')
  if (problems.length === 0 && comboCount === 0) {
    problems.push('No drillable combos — every pairing is unsatisfiable')
  }

  const toggle = <T,>(list: readonly T[], item: T): T[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item]

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-950 p-4">
      <h4 className="text-sm font-semibold text-slate-100">
        {preset ? `Edit “${preset.name}”` : 'New preset'}
      </h4>
      <TextField
        label="Name"
        value={name}
        placeholder="e.g. Jazz sevenths, open"
        onChange={setName}
      />
      <SelectField
        label="Chord pool"
        value={kind}
        options={POOL_OPTIONS}
        onChange={setKind}
      />

      {kind === 'product' && (
        <>
          <ChipGroup label="Roots">
            {ALL_PITCH_CLASSES.map((pc) => (
              <Chip
                key={pc}
                label={formatSpelling(spellRoot(pc))}
                selected={roots.includes(pc)}
                onToggle={() => setRoots(toggle(roots, pc))}
              />
            ))}
          </ChipGroup>
          <ChipGroup label="Chord types">
            {CHORD_TYPES.map((type) => (
              <Chip
                key={type.id}
                label={type.name}
                selected={chordTypes.includes(type.id)}
                onToggle={() => setChordTypes(toggle(chordTypes, type.id))}
              />
            ))}
          </ChipGroup>
        </>
      )}

      {kind === 'explicit' && (
        <div className="flex flex-col gap-2">
          {explicit.map((chord, index) => (
            <div key={index} className="flex items-center gap-2">
              <select
                aria-label={`Chord ${index + 1} root`}
                value={String(chord.root)}
                onChange={(e) =>
                  setExplicit(
                    explicit.map((c, i) =>
                      i === index
                        ? { ...c, root: Number(e.target.value) as PitchClass }
                        : c,
                    ),
                  )
                }
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
              >
                {ROOT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Chord ${index + 1} type`}
                value={chord.typeId}
                onChange={(e) =>
                  setExplicit(
                    explicit.map((c, i) =>
                      i === index
                        ? { ...c, typeId: e.target.value as ChordTypeId }
                        : c,
                    ),
                  )
                }
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`Remove chord ${index + 1}`}
                onClick={() =>
                  setExplicit(explicit.filter((_, i) => i !== index))
                }
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:border-slate-500"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              setExplicit([...explicit, { root: 0, typeId: 'maj' }])
            }
            className="self-start rounded-md border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500"
          >
            + Add chord
          </button>
        </div>
      )}

      {kind === 'diatonic' && (
        <SelectField
          label="Key"
          value={String(diatonicKey)}
          options={KEY_OPTIONS}
          onChange={(v) => setDiatonicKey(Number(v) as PitchClass)}
        />
      )}

      <ChipGroup label="Voicing rules">
        {library.rules.map((rule) => (
          <Chip
            key={rule.id}
            label={rule.name}
            selected={voicingIds.includes(rule.id)}
            onToggle={() => setVoicingIds(toggle(voicingIds, rule.id))}
          />
        ))}
      </ChipGroup>

      {problems.length > 0 ? (
        <p className="text-xs text-amber-400">⚠ {problems.join(' · ')}</p>
      ) : (
        <p className="text-xs text-slate-400">
          {comboCount} combo{comboCount === 1 ? '' : 's'} to drill
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-amber-400">
          {warnings.map((warning) => (
            <li key={`${warning.typeId}:${warning.voicingId}:${warning.kind}`}>
              ⚠ {warning.message}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          disabled={problems.length > 0}
          onClick={() => {
            if (savePreset(draft)) onClose()
          }}
          className="rounded-md bg-emerald-700 px-3 py-1 text-sm font-medium text-emerald-50 transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
        >
          Save preset
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-300 transition-colors hover:border-slate-500"
        >
          Cancel
        </button>
        {preset && (
          <button
            type="button"
            onClick={() => {
              deletePreset(preset.id)
              onClose()
            }}
            className="ml-auto rounded-md border border-rose-900 px-3 py-1 text-sm text-rose-400 transition-colors hover:border-rose-600"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

function ChipGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-slate-200">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}
