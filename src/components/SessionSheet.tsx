import { useEffect } from 'react'
import { usePractice } from '../store/practiceStore'
import { settingsStore, useSettings } from '../store/settingsStore'
import {
  MAX_SONG_TEMPO_BPM,
  MIN_SONG_TEMPO_BPM,
  SESSION_LENGTHS,
  SONG_CHORD_COUNTS,
  type SessionMode,
} from '../practice'
import { ALL_PITCH_CLASSES, keyDisplayName } from '../theory'
import { Chip, RaisedButton, SectionLabel, Toggle } from './ui'
import { cx } from './cx'

// The session sheet (DESIGN.md §7.2): a modal over Home or the Stage holding
// everything that defines a session — preset, mode with its inline
// sub-settings (§7.3), and length. Start (re)starts the session with the
// chosen config. Length is hidden in Song, which runs until ended.
const MODES: { id: SessionMode; label: string }[] = [
  { id: 'learn', label: '🎓 Learn' },
  { id: 'practice', label: '▶ Practice' },
  { id: 'song', label: '♪ Song' },
]

const LENGTHS: { value: number | null; label: string }[] = [
  ...SESSION_LENGTHS.map((n) => ({
    value: n as number | null,
    label: String(n),
  })),
  { value: null, label: '∞' },
]

export function SessionSheet({
  onStart,
  onClose,
}: {
  onStart: () => void
  onClose: () => void
}) {
  const mode = usePractice((s) => s.mode)
  const setMode = usePractice((s) => s.setMode)
  const sessionLength = usePractice((s) => s.sessionLength)
  const setSessionLength = usePractice((s) => s.setSessionLength)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0a0c1a]/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Session"
    >
      {/* Backdrop click closes. */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <div className="relative flex w-[420px] max-w-full flex-col gap-4 rounded-[22px] border-2 border-card-border bg-card p-6 text-ink shadow-hard-lg">
        <div className="flex items-center">
          <b className="text-[22px] font-extrabold">Session</b>
          <RaisedButton
            variant="outline"
            size="sm"
            className="ml-auto"
            onClick={onClose}
          >
            ✕
          </RaisedButton>
        </div>

        <PresetField />

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Mode</SectionLabel>
          <div className="flex overflow-hidden rounded-[14px] border-2 border-card-border">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                className={cx(
                  'flex-1 py-2.5 text-[15px] transition-colors',
                  mode === m.id
                    ? 'bg-primary font-extrabold text-primary-ink'
                    : 'font-semibold text-ink-muted hover:text-ink-soft',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          <ModeSettings mode={mode} />
        </div>

        {mode !== 'song' && (
          <div className="flex flex-col gap-1.5">
            <SectionLabel>Length</SectionLabel>
            <div className="flex gap-2">
              {LENGTHS.map((len) => (
                <Chip
                  key={len.label}
                  selected={sessionLength === len.value}
                  onClick={() => setSessionLength(len.value)}
                  className="px-3.5 py-1.5 text-sm"
                >
                  {len.label}
                </Chip>
              ))}
            </div>
          </div>
        )}

        <RaisedButton
          autoFocus
          variant="primary"
          size="lg"
          className="w-full"
          onClick={onStart}
        >
          Start ▶
        </RaisedButton>
      </div>
    </div>
  )
}

// The preset chooser: the same selection the Continue card and every mode
// share (§7.2). A themed native select; the diatonic preset adds its key.
function PresetField() {
  const presets = usePractice((s) => s.presets)
  const presetId = usePractice((s) => s.presetId)
  const setPreset = usePractice((s) => s.setPreset)
  const diatonicKey = usePractice((s) => s.diatonicKey)
  const setDiatonicKey = usePractice((s) => s.setDiatonicKey)
  const active = presets.find((p) => p.id === presetId)

  return (
    <div className="flex flex-col gap-1.5">
      <SectionLabel>Preset</SectionLabel>
      <div className="flex gap-2">
        <select
          value={presetId}
          onChange={(e) => setPreset(e.target.value)}
          aria-label="Preset"
          className={SELECT_CLASS}
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
        {active?.pool.kind === 'diatonic' && (
          <select
            value={diatonicKey}
            onChange={(e) => setDiatonicKey(Number(e.target.value))}
            aria-label="Key"
            className={SELECT_CLASS}
          >
            {ALL_PITCH_CLASSES.map((pc) => (
              <option key={pc} value={pc}>
                {keyDisplayName(pc)}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

function ModeSettings({ mode }: { mode: SessionMode }) {
  if (mode === 'learn') return <NotPassedOnlyRow />
  if (mode === 'practice') return <WorstOnlyRow />
  return <SongSettings />
}

function NotPassedOnlyRow() {
  const notPassedOnly = usePractice((s) => s.notPassedOnly)
  const setNotPassedOnly = usePractice((s) => s.setNotPassedOnly)
  const progress = usePractice((s) => s.progress)
  const disabled = progress.unlocked === progress.passed && !notPassedOnly
  return (
    <SettingRow label="Not passed only" disabled={disabled}>
      <Toggle
        checked={notPassedOnly}
        onChange={setNotPassedOnly}
        disabled={disabled}
        aria-label="Not passed only"
      />
    </SettingRow>
  )
}

function WorstOnlyRow() {
  const worstOnly = usePractice((s) => s.worstOnly)
  const setWorstOnly = usePractice((s) => s.setWorstOnly)
  const worstChords = usePractice((s) => s.worstChords)
  const disabled = worstChords.length === 0 && !worstOnly
  return (
    <SettingRow label="Worst chords only" disabled={disabled}>
      <Toggle
        checked={worstOnly}
        onChange={setWorstOnly}
        disabled={disabled}
        aria-label="Worst chords only"
      />
    </SettingRow>
  )
}

function SongSettings() {
  const tempo = useSettings((s) => s.settings.songTempoBpm)
  const chordCount = useSettings((s) => s.settings.songChordCount)
  const showExample = useSettings((s) => s.settings.songShowExample)
  const update = settingsStore.getState().update

  return (
    <div className="mt-1 flex flex-col gap-2.5">
      <SettingRow label={`Tempo · ${tempo} bpm`}>
        <div className="flex items-center gap-2">
          <StepBtn
            label="Decrease tempo"
            disabled={tempo <= MIN_SONG_TEMPO_BPM}
            onClick={() => update({ songTempoBpm: tempo - 5 })}
          >
            −
          </StepBtn>
          <StepBtn
            label="Increase tempo"
            disabled={tempo >= MAX_SONG_TEMPO_BPM}
            onClick={() => update({ songTempoBpm: tempo + 5 })}
          >
            +
          </StepBtn>
        </div>
      </SettingRow>
      <SettingRow label="Chords per progression">
        <div className="flex gap-1.5">
          {SONG_CHORD_COUNTS.map((count) => (
            <Chip
              key={count}
              selected={chordCount === count}
              onClick={() => update({ songChordCount: count })}
              className="px-3 py-1 text-sm"
            >
              {count}
            </Chip>
          ))}
        </div>
      </SettingRow>
      <SettingRow label="Show example">
        <Toggle
          checked={showExample}
          onChange={(v) => update({ songShowExample: v })}
          aria-label="Show example"
        />
      </SettingRow>
    </div>
  )
}

function SettingRow({
  label,
  disabled = false,
  children,
}: {
  label: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cx(
        'mt-1 flex min-h-8 items-center justify-between gap-3 text-[15px] font-semibold',
        disabled ? 'text-ink-faint' : 'text-ink-soft',
      )}
    >
      {label}
      {children}
    </div>
  )
}

function StepBtn({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-[10px] border-2 border-muted-border bg-transparent text-base font-extrabold leading-none text-ink-soft transition-transform active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

const SELECT_CLASS =
  'flex-1 rounded-[14px] border-2 border-card-border bg-surface px-3.5 py-2.5 text-[15px] font-semibold text-ink'
