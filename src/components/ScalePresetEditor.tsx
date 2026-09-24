import { useState, type ReactNode } from 'react'
import {
  ALL_PITCH_CLASSES,
  SCALE_SHAPES,
  SCALE_TYPES,
  formatSpelling,
  spellRoot,
  type PitchClass,
  type ScaleShapeId,
  type ScaleTypeId,
} from '../theory'
import {
  builtInPresets,
  builtInScalePresets,
  expandPreset,
  newLibraryId,
  type ScalePreset,
} from '../practice'
import { useLibrary } from '../store/libraryStore'
import { Chip, TextField } from './fields'

// The scale side of the §4 preset editor: roots × scale types × shapes, with
// no voicing references and nothing to warn about — every scale plays in
// every shape, so any non-empty pick is drillable.

const BUILT_IN_PRESET_IDS = [...builtInPresets(), ...builtInScalePresets()].map(
  (p) => p.id,
)

export function ScalePresetEditor({
  preset,
  kindPicker,
  onClose,
}: {
  preset: ScalePreset | null // null = creating a new preset
  kindPicker?: ReactNode
  onClose: () => void
}) {
  const customPresets = useLibrary((s) => s.customPresets)
  const savePreset = useLibrary((s) => s.savePreset)
  const deletePreset = useLibrary((s) => s.deletePreset)

  const [name, setName] = useState(preset?.name ?? '')
  const [roots, setRoots] = useState<readonly PitchClass[]>(
    preset?.pool.roots ?? ALL_PITCH_CLASSES,
  )
  const [scaleTypes, setScaleTypes] = useState<readonly ScaleTypeId[]>(
    preset?.pool.scaleTypes ?? ['major'],
  )
  const [shapeIds, setShapeIds] = useState<readonly ScaleShapeId[]>(
    preset?.shapeIds ?? ['up-1'],
  )

  const draft: ScalePreset = {
    kind: 'scale',
    id:
      preset?.id ??
      newLibraryId(
        'preset',
        new Set([...BUILT_IN_PRESET_IDS, ...customPresets.map((p) => p.id)]),
      ),
    name: name.trim(),
    pool: { kind: 'product', roots, scaleTypes },
    shapeIds,
  }
  const comboCount = expandPreset(draft).combos.length

  const problems: string[] = []
  if (draft.name === '') problems.push('Name the preset')
  if (roots.length === 0) problems.push('Pick a root')
  if (scaleTypes.length === 0) problems.push('Pick a scale type')
  if (shapeIds.length === 0) problems.push('Pick a shape')

  const toggle = <T,>(list: readonly T[], item: T): T[] =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item]

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-950 p-4">
      <h4 className="text-sm font-semibold text-slate-100">
        {preset ? `Edit “${preset.name}”` : 'New preset'}
      </h4>
      {kindPicker}
      <TextField
        label="Name"
        value={name}
        placeholder="e.g. Flat keys, 2 octaves"
        onChange={setName}
      />

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
      <ChipGroup label="Scale types">
        {SCALE_TYPES.map((type) => (
          <Chip
            key={type.id}
            label={type.name}
            selected={scaleTypes.includes(type.id)}
            onToggle={() => setScaleTypes(toggle(scaleTypes, type.id))}
          />
        ))}
      </ChipGroup>
      <ChipGroup label="Shapes">
        {SCALE_SHAPES.map((shape) => (
          <Chip
            key={shape.id}
            label={shape.name}
            selected={shapeIds.includes(shape.id)}
            onToggle={() => setShapeIds(toggle(shapeIds, shape.id))}
          />
        ))}
      </ChipGroup>

      {problems.length > 0 ? (
        <p className="text-xs text-warn">⚠ {problems.join(' · ')}</p>
      ) : (
        <p className="text-xs text-slate-400">
          {comboCount} combo{comboCount === 1 ? '' : 's'} to drill
        </p>
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
  children: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm text-slate-200">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}
