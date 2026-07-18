import { usePractice } from '../store/practiceStore'
import { ALL_PITCH_CLASSES, keyDisplayName } from '../theory'

// Top-bar preset picker (§4, §7); the diatonic preset adds a major-key
// picker beside it. Song mode (§6.5) ignores presets entirely, so the
// preset select is replaced by the key picker alone.
export function PresetPicker() {
  const presets = usePractice((s) => s.presets)
  const presetId = usePractice((s) => s.presetId)
  const mode = usePractice((s) => s.mode)
  const setPreset = usePractice((s) => s.setPreset)

  const active = presets.find((p) => p.id === presetId)
  const showKey = mode === 'song' || active?.pool.kind === 'diatonic'

  return (
    <div className="flex items-center gap-2">
      {mode !== 'song' && (
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
      )}
      {showKey && <KeySelect />}
    </div>
  )
}

function KeySelect() {
  const diatonicKey = usePractice((s) => s.diatonicKey)
  const setDiatonicKey = usePractice((s) => s.setDiatonicKey)
  return (
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
  )
}
