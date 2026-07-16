import { usePractice } from '../store/practiceStore'
import { ALL_PITCH_CLASSES, keyDisplayName } from '../theory'

// Top-bar preset picker (§4, §7); the diatonic preset adds a major-key
// picker beside it.
export function PresetPicker() {
  const presets = usePractice((s) => s.presets)
  const presetId = usePractice((s) => s.presetId)
  const diatonicKey = usePractice((s) => s.diatonicKey)
  const setPreset = usePractice((s) => s.setPreset)
  const setDiatonicKey = usePractice((s) => s.setDiatonicKey)

  const active = presets.find((p) => p.id === presetId)

  return (
    <div className="flex items-center gap-2">
      <select
        className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
        value={presetId}
        onChange={(e) => setPreset(e.target.value)}
        aria-label="Practice preset"
      >
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.name}
          </option>
        ))}
      </select>
      {active?.pool.kind === 'diatonic' && (
        <select
          className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
          value={diatonicKey}
          onChange={(e) => setDiatonicKey(Number(e.target.value))}
          aria-label="Key"
        >
          {ALL_PITCH_CLASSES.map((pc) => (
            <option key={pc} value={pc}>
              {keyDisplayName(pc)}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
