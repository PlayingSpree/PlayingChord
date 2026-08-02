import { useEffect, useMemo, useState } from 'react'
import {
  practiceStore,
  resolveAppPool,
  usePractice,
} from '../store/practiceStore'
import { settingsStore, useSettings } from '../store/settingsStore'
import {
  DAILY_CAP_MINUTES,
  MAX_SONG_TEMPO_BPM,
  MIN_SONG_TEMPO_BPM,
  MODE_POLICY,
  SESSION_MINUTE_LENGTHS,
  SESSION_PROMPT_LENGTHS,
  SONG_CHORD_COUNTS,
  type SessionLength,
  type SessionLengthUnit,
  type SessionMode,
} from '../practice'
import { ALL_PITCH_CLASSES, keyDisplayName, type PitchClass } from '../theory'
import { Chip, RaisedButton, SectionLabel, Toggle } from './ui'
import { MODE_LABELS, MODE_ORDER } from './modes'
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
// Length values per unit (§7.2), ∞ last in both. A unit switch rather than
// one long row: prompts and minutes answer different questions ("give me 20
// reps" vs "give me 10 minutes") and mixing them in a single row of chips
// makes neither readable.
const LENGTH_VALUES: Record<SessionLengthUnit, (number | null)[]> = {
  prompts: [...SESSION_PROMPT_LENGTHS, null],
  minutes: [...SESSION_MINUTE_LENGTHS, null],
}

const UNITS: { id: SessionLengthUnit; label: string }[] = [
  { id: 'prompts', label: 'Prompts' },
  { id: 'minutes', label: 'Minutes' },
]

interface Draft {
  presetId: string
  diatonicKey: PitchClass
  mode: SessionMode
  sessionLength: SessionLength
  worstOnly: boolean
  // The learn loop's chords (§5.4), as poolChordKeys. Re-derived from the
  // drafted preset whenever that changes — the keys of one preset mean nothing
  // in another.
  learnSelection: readonly string[]
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
      learnSelection: state.learnSelection,
    }
  })
  const patch = (fields: Partial<Draft>) =>
    setDraft((current) => ({ ...current, ...fields }))
  // Changing the drafted preset invalidates the learn set with it (§5.4): the
  // keys name chords in a pool that is no longer the one being configured, so
  // the picker reopens on the new preset's default.
  const patchPreset = (fields: Partial<Draft>) =>
    setDraft((current) => {
      const next = { ...current, ...fields }
      return {
        ...next,
        learnSelection: resolveAppPool(
          next.presetId,
          next.diatonicKey,
        ).defaultLearnSet(),
      }
    })
  const daily = draft.mode === 'daily'
  // What daily practice would deal right now (§5.3) — read once per open,
  // like the worst-only availability below: the sheet sits outside a session,
  // so nothing can change under it while it's up.
  const [learnedChords] = useState(() =>
    practiceStore.getState().learnedChordCount(),
  )

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
    store.setLearnSelection(draft.learnSelection)
    onStart()
  }

  // The learn loop needs something to finish (§5.4); an empty set would end
  // the session on its first rep.
  const startable =
    !MODE_POLICY[draft.mode].hasLearnLoop || draft.learnSelection.length > 0

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

        {/* Daily practice draws from every preset's learned chords (§5.3), so
            there is no preset to pick — the picker would look like it was
            choosing the pool when it wasn't. It still governs the other three
            modes, so it comes back with them. */}
        <div className={cx('flex flex-col gap-1.5', daily && 'hidden')}>
          <SectionLabel>Preset</SectionLabel>
          <div className="flex gap-2">
            <select
              value={draft.presetId}
              onChange={(e) => patchPreset({ presetId: e.target.value })}
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
                onChange={(e) =>
                  patchPreset({ diatonicKey: Number(e.target.value) })
                }
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
            {MODE_ORDER.map((id) => {
              // Nothing learned yet, nothing for daily to deal (§5.3).
              const locked = id === 'daily' && learnedChords === 0
              return (
                <button
                  key={id}
                  type="button"
                  disabled={locked}
                  onClick={() => patch({ mode: id })}
                  className={cx(
                    'flex-1 py-2.5 text-[13px] transition-colors',
                    draft.mode === id
                      ? 'bg-primary font-extrabold text-primary-ink'
                      : locked
                        ? 'font-semibold text-ink-faint'
                        : 'font-semibold text-ink-muted hover:text-ink-soft',
                  )}
                >
                  {MODE_LABELS[id]}
                </button>
              )
            })}
          </div>
          {MODE_POLICY[draft.mode].hasLearnLoop && (
            <LearnSetPicker
              presetId={draft.presetId}
              diatonicKey={draft.diatonicKey}
              selection={draft.learnSelection}
              onChange={(learnSelection) => patch({ learnSelection })}
            />
          )}
          {daily && <DailySettings learnedChords={learnedChords} />}
          {MODE_POLICY[draft.mode].supportsWorstOnly && (
            <WorstOnlyRow
              presetId={draft.presetId}
              diatonicKey={draft.diatonicKey}
              value={draft.worstOnly}
              onChange={(worstOnly) => patch({ worstOnly })}
            />
          )}
          {draft.mode === 'song' && <SongSettings />}
        </div>

        {/* Song runs until ended, daily runs to its own cap (§5.3) and Learn
            runs until its set is rehearsed (§5.4), so the length is free
            practice's alone — the modes that draft one, per the policy. */}
        {MODE_POLICY[draft.mode].length === 'drafted' && (
          <div className="flex flex-col gap-1.5">
            <SectionLabel>Length</SectionLabel>
            <div className="flex overflow-hidden rounded-[14px] border-2 border-card-border">
              {UNITS.map((unit) => (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() =>
                    patch({
                      sessionLength: {
                        unit: unit.id,
                        // Switching unit keeps ∞ but can't keep a number —
                        // 20 prompts is not 20 minutes. Fall to the middle
                        // value of the new unit, which is also its default.
                        value:
                          draft.sessionLength.value === null
                            ? null
                            : (LENGTH_VALUES[unit.id][1] ?? null),
                      },
                    })
                  }
                  className={cx(
                    'flex-1 py-2 text-[14px] transition-colors',
                    draft.sessionLength.unit === unit.id
                      ? 'bg-info font-extrabold text-primary-ink'
                      : 'font-semibold text-ink-muted hover:text-ink-soft',
                  )}
                >
                  {unit.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              {LENGTH_VALUES[draft.sessionLength.unit].map((value) => (
                <Chip
                  key={value ?? '∞'}
                  selected={draft.sessionLength.value === value}
                  onClick={() =>
                    patch({
                      sessionLength: { unit: draft.sessionLength.unit, value },
                    })
                  }
                  className="px-3.5 py-1.5 text-sm"
                >
                  {value ?? '∞'}
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
          disabled={!startable}
          onClick={start}
        >
          Start ▶
        </RaisedButton>
      </div>
    </div>
  )
}

// Daily practice's whole configuration (§5.3): how long it runs, and a line
// saying what it will deal. The cap is a persisted preference, not session
// config — like Song's tempo it writes straight through as it's set, because
// the point of the daily drill is that it is the same tomorrow.
function DailySettings({ learnedChords }: { learnedChords: number }) {
  const cap = useSettings((s) => s.settings.dailyCapMinutes)
  const update = settingsStore.getState().update
  return (
    <div className="mt-1 flex flex-col gap-2.5">
      <SettingRow label="Cap">
        <div className="flex gap-1.5">
          {DAILY_CAP_MINUTES.map((minutes) => (
            <Chip
              key={minutes}
              selected={cap === minutes}
              onClick={() => update({ dailyCapMinutes: minutes })}
              className="px-3 py-1 text-sm"
            >
              {minutes}m
            </Chip>
          ))}
        </div>
      </SettingRow>
      <p className="text-[13px] text-ink-muted">
        Every chord you have learned, from every preset —{' '}
        <b className="font-semibold text-ink-soft">
          {learnedChords} chord{learnedChords === 1 ? '' : 's'}
        </b>
        . Unlocking stays in Learn and Free.
      </p>
    </div>
  )
}

// The learn loop's chord set (§5.4). Every chord in play in the drafted preset
// is offered; the ones not yet passed come pre-ticked, because "learn the new
// ones" is what the mode is for and picking them by hand every time would be
// busywork. Read of the *draft* preset, like WorstOnlyRow — the sheet's picks
// don't reach the store until Start.
//
// A one- or two-chord set is fine to pick: the loop deals learned chords
// alongside it to keep three in play (§5.4), and the line below says which,
// so the pool is never a surprise on the Stage.
function LearnSetPicker({
  presetId,
  diatonicKey,
  selection,
  onChange,
}: {
  presetId: string
  diatonicKey: PitchClass
  selection: readonly string[]
  onChange: (next: readonly string[]) => void
}) {
  const choices = useMemo(
    () => resolveAppPool(presetId, diatonicKey).learnChoices(),
    [presetId, diatonicKey],
  )
  const filler = useMemo(
    () => resolveAppPool(presetId, diatonicKey).fillerLabels(selection),
    [presetId, diatonicKey, selection],
  )
  const picked = new Set(selection)
  // Kept in the pool's unlock order however they were ticked, so the set reads
  // the same way the In play row does.
  const toggle = (key: string) =>
    onChange(
      choices
        .filter((c) => (c.key === key ? !picked.has(key) : picked.has(c.key)))
        .map((c) => c.key),
    )

  return (
    <div className="mt-1 flex flex-col gap-2">
      <SectionLabel>Chords to learn</SectionLabel>
      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          <Chip
            key={choice.key}
            selected={picked.has(choice.key)}
            onClick={() => toggle(choice.key)}
            className="px-3 py-1.5 text-sm"
          >
            {choice.label}
            {!choice.passed && (
              <span className="text-[11px] font-bold uppercase tracking-wide text-info-light">
                new
              </span>
            )}
          </Chip>
        ))}
      </div>
      <p className="text-[13px] text-ink-muted">
        {selection.length === 0 ? (
          'Pick at least one chord to learn.'
        ) : (
          <>
            Runs until{' '}
            <b className="font-semibold text-ink-soft">
              {selection.length === 1
                ? 'this chord'
                : `all ${selection.length} chords`}
            </b>{' '}
            {selection.length === 1 ? 'reaches' : 'reach'} D this session
            {filler.length > 0 && <> · dealt with {filler.join(', ')}</>}.
          </>
        )}
      </p>
    </div>
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
  // Would the toggle have anything to narrow to (§5)? Asked of the *drafted*
  // preset, and read once per open like the learned count above.
  const canDrill = useMemo(
    () => resolveAppPool(presetId, diatonicKey).worstOnly().length > 0,
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
