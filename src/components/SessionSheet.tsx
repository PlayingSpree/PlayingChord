import { useEffect, useMemo, useState } from 'react'
import { practiceStore, usePractice } from '../store/practiceStore'
import { settingsStore, useSettings } from '../store/settingsStore'
import {
  MAX_SONG_TEMPO_BPM,
  MIN_SONG_TEMPO_BPM,
  SESSION_LENGTHS,
  SONG_CHORD_COUNTS,
  type SessionMode,
} from '../practice'
import { ALL_PITCH_CLASSES, keyDisplayName, type PitchClass } from '../theory'
import { Chip, RaisedButton, SectionLabel, Toggle } from './ui'
import { cx } from './cx'

// The session sheet (DESIGN.md §7.2): a modal over Home or the Stage holding
// everything that defines a session — preset, mode with its inline
// sub-settings (§7.3), and length. Length is hidden in Song, which runs until
// ended.
//
// The picks are a *draft*: nothing reaches the practice store until Start,
// which discards whatever session was running and begins a new one with the
// chosen config. Closing without starting leaves the session it was opened
// over exactly as it was (the caller paused it, and resumes it on close).
// Song's tempo / chord count / show-example are the exception — they're
// persisted preferences that apply from the next beat or progression (§7.3),
// not session config, so they keep writing straight through to settings.
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

interface Draft {
  presetId: string
  diatonicKey: PitchClass
  mode: SessionMode
  sessionLength: number | null
  worstOnly: boolean
  notPassedOnly: boolean
}

export function SessionSheet({
  onStart,
  onClose,
}: {
  onStart: () => void
  onClose: () => void
}) {
  const presets = usePractice((s) => s.presets)
  const [draft, setDraft] = useState<Draft>(() => {
    const state = practiceStore.getState()
    return {
      presetId: state.presetId,
      diatonicKey: state.diatonicKey,
      mode: state.mode,
      sessionLength: state.sessionLength,
      worstOnly: state.worstOnly,
      notPassedOnly: state.notPassedOnly,
    }
  })
  const patch = (fields: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...fields }))

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Commit the draft, then hand off to the caller's start (which remounts the
  // Stage). The in-flight session is discarded first so the setters below are
  // pure config — they can't deal a prompt into a session that's ending.
  const start = () => {
    const store = practiceStore.getState()
    store.discardSession()
    store.setPreset(draft.presetId)
    store.setDiatonicKey(draft.diatonicKey)
    store.setMode(draft.mode)
    store.setSessionLength(draft.sessionLength)
    store.setWorstOnly(draft.worstOnly)
    store.setNotPassedOnly(draft.notPassedOnly)
    onStart()
  }

  const activePreset = presets.find((p) => p.id === draft.presetId)

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

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Preset</SectionLabel>
          <div className="flex gap-2">
            <select
              value={draft.presetId}
              onChange={(e) => patch({ presetId: e.target.value })}
              aria-label="Preset"
              className={SELECT_CLASS}
            >
              {presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            {activePreset?.pool.kind === 'diatonic' && (
              <select
                value={draft.diatonicKey}
                onChange={(e) => patch({ diatonicKey: Number(e.target.value) })}
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

        <div className="flex flex-col gap-1.5">
          <SectionLabel>Mode</SectionLabel>
          <div className="flex overflow-hidden rounded-[14px] border-2 border-card-border">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => patch({ mode: m.id })}
                className={cx(
                  'flex-1 py-2.5 text-[15px] transition-colors',
                  draft.mode === m.id
                    ? 'bg-primary font-extrabold text-primary-ink'
                    : 'font-semibold text-ink-muted hover:text-ink-soft',
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
          {draft.mode === 'learn' && (
            <NotPassedOnlyRow
              value={draft.notPassedOnly}
              onChange={(notPassedOnly) => patch({ notPassedOnly })}
            />
          )}
          {draft.mode === 'practice' && (
            <WorstOnlyRow
              presetId={draft.presetId}
              diatonicKey={draft.diatonicKey}
              value={draft.worstOnly}
              onChange={(worstOnly) => patch({ worstOnly })}
            />
          )}
          {draft.mode === 'song' && <SongSettings />}
        </div>

        {draft.mode !== 'song' && (
          <div className="flex flex-col gap-1.5">
            <SectionLabel>Length</SectionLabel>
            <div className="flex gap-2">
              {LENGTHS.map((len) => (
                <Chip
                  key={len.label}
                  selected={draft.sessionLength === len.value}
                  onClick={() => patch({ sessionLength: len.value })}
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
          onClick={start}
        >
          Start ▶
        </RaisedButton>
      </div>
    </div>
  )
}

function NotPassedOnlyRow({
  value,
  onChange,
}: {
  value: boolean
  onChange: (next: boolean) => void
}) {
  const progress = usePractice((s) => s.progress)
  const disabled = progress.unlocked === progress.passed && !value
  return (
    <SettingRow label="Not passed only" disabled={disabled}>
      <Toggle
        checked={value}
        onChange={onChange}
        disabled={disabled}
        aria-label="Not passed only"
      />
    </SettingRow>
  )
}

// Off and unavailable when the drafted preset has no weak spots to drill
// (§5): everything unlocked is passed and nothing was ever missed, so the
// toggle would only fall back to the full pool. Asked of the *draft* preset,
// not the store's active one, and recomputed from the persisted records each
// time the picks change — the sheet is opened before a session deals anything.
function WorstOnlyRow({
  presetId,
  diatonicKey,
  value,
  onChange,
}: {
  presetId: string
  diatonicKey: PitchClass
  value: boolean
  onChange: (next: boolean) => void
}) {
  const canDrill = useMemo(
    () => practiceStore.getState().canDrillWorstOnly(presetId, diatonicKey),
    [presetId, diatonicKey],
  )
  const disabled = !canDrill && !value
  return (
    <SettingRow label="Worst chords only" disabled={disabled}>
      <Toggle
        checked={value}
        onChange={onChange}
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
      <SettingRow label="Tempo">
        <TempoField
          tempo={tempo}
          onChange={(bpm) => update({ songTempoBpm: bpm })}
        />
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

// ± in 5 bpm steps, or type a value directly — 40 → 140 is a long way in
// clicks. Committing on blur, not per keystroke: the sanitizer clamps to
// [40, 140], which would rewrite "1" to 40 midway through typing "100".
function TempoField({
  tempo,
  onChange,
}: {
  tempo: number
  onChange: (bpm: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft !== null && draft !== '') onChange(Number(draft))
    setDraft(null)
  }
  return (
    <div className="flex items-center gap-2">
      <StepBtn
        label="Decrease tempo"
        disabled={tempo <= MIN_SONG_TEMPO_BPM}
        onClick={() => onChange(tempo - 5)}
      >
        −
      </StepBtn>
      <input
        type="number"
        min={MIN_SONG_TEMPO_BPM}
        max={MAX_SONG_TEMPO_BPM}
        value={draft ?? tempo}
        aria-label="Tempo in beats per minute"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        className="w-16 rounded-[10px] border-2 border-muted-border bg-surface px-2 py-1 text-right text-[15px] font-semibold tabular-nums text-ink"
      />
      <span className="text-[13px] text-ink-muted">bpm</span>
      <StepBtn
        label="Increase tempo"
        disabled={tempo >= MAX_SONG_TEMPO_BPM}
        onClick={() => onChange(tempo + 5)}
      >
        +
      </StepBtn>
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
