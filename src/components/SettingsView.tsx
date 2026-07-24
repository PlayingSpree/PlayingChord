import { useRef, useState } from 'react'
import { BUILT_IN_VOICING_RULES, type VoicingRule } from '../theory'
import {
  builtInPresets,
  CHORD_NAME_SIZES,
  describeVoicingRule,
  MAX_DAILY_GOAL_MINUTES,
  MAX_DELAY_MS,
  poolChords,
  type ChordNameSize,
  type Preset,
} from '../practice'
import type { ImportResult } from '../storage'
import { useSettings } from '../store/settingsStore'
import { useLibrary } from '../store/libraryStore'
import { practiceStore } from '../store/practiceStore'
import { DevicePicker } from './DevicePicker'
import { VoicingBuilder } from './VoicingBuilder'
import { PresetEditor } from './PresetEditor'
import { Card, Chip, RaisedButton, Stepper, Toggle } from './ui'
import { cx } from './cx'

// The §7.6 settings screen, grouped into cards: Sound / Notation / Matching &
// timing / Goal & unlocks / Voicing rules / Presets. Mode sub-settings and the
// session length live in the session sheet (§7.2), not here. The Phase 9
// library — voicing builder, preset editor, JSON import/export — keeps its
// behavior; only the chrome is restyled.

type Editing =
  | { kind: 'rule'; rule: VoicingRule | null } // null = new
  | { kind: 'preset'; preset: Preset | null }
  | null

export function SettingsView({ onBack }: { onBack: () => void }) {
  const [editing, setEditing] = useState<Editing>(null)

  return (
    <main className="min-h-screen bg-surface px-6 py-6 text-ink">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <header className="flex items-center gap-3.5">
          <RaisedButton variant="outline" size="sm" onClick={onBack}>
            ← Home
          </RaisedButton>
          <span className="text-2xl font-extrabold">Settings</span>
          <span className="flex-1" />
          <DevicePicker />
        </header>

        <div className="grid gap-3 lg:grid-cols-2">
          <SoundSection />
          <NotationSection />
          <MatchingSection />
          <GoalSection />
        </div>

        <VoicingRulesSection
          editing={editing?.kind === 'rule' ? editing : null}
          onEdit={(rule) => setEditing({ kind: 'rule', rule })}
          onClose={() => setEditing(null)}
        />
        <PresetsSection
          editing={editing?.kind === 'preset' ? editing : null}
          onEdit={(preset) => setEditing({ kind: 'preset', preset })}
          onClose={() => setEditing(null)}
        />
        <ImportExportSection />
      </div>
    </main>
  )
}

function SettingsCard({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <Card className="flex flex-col gap-3 p-[18px]" aria-label={title}>
      <div>
        <b className="text-base">{title}</b>
        {hint && <div className="text-xs text-ink-muted">{hint}</div>}
      </div>
      {children}
    </Card>
  )
}

function Row({
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
        'flex min-h-8 items-center justify-between gap-3 text-[15px] font-semibold',
        disabled ? 'text-ink-faint' : 'text-ink-soft',
      )}
    >
      <span>{label}</span>
      {children}
    </div>
  )
}

function SoundSection() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  return (
    <SettingsCard title="Sound" hint="misses are always silent">
      <Row label="Chime on correct">
        <Toggle
          checked={settings.chimeEnabled}
          onChange={(v) => update({ chimeEnabled: v })}
          aria-label="Chime on correct"
        />
      </Row>
      <Row label="Piano sound on key press">
        <Toggle
          checked={settings.pianoSoundEnabled}
          onChange={(v) => update({ pianoSoundEnabled: v })}
          aria-label="Piano sound on key press"
        />
      </Row>
    </SettingsCard>
  )
}

const NAME_SIZE_LABEL: Record<ChordNameSize, string> = {
  sm: 'S',
  md: 'M',
  lg: 'L',
  xl: 'XL',
}

function NotationSection() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  return (
    <SettingsCard
      title="Notation"
      hint="the keyboard carries practice — staff is optional"
    >
      <Row label="Show staff notation">
        <Toggle
          checked={settings.staffEnabled}
          onChange={(v) => update({ staffEnabled: v })}
          aria-label="Show staff notation"
        />
      </Row>
      <Row label="Key signature (chord root)">
        <Toggle
          checked={settings.staffKeyEnabled}
          onChange={(v) => update({ staffKeyEnabled: v })}
          aria-label="Key signature"
        />
      </Row>
      <Row label="Chord name size">
        <div className="flex gap-1.5">
          {CHORD_NAME_SIZES.map((size) => (
            <Chip
              key={size}
              selected={settings.chordNameSize === size}
              onClick={() => update({ chordNameSize: size })}
              className="px-2.5 py-1 text-[13px]"
            >
              {NAME_SIZE_LABEL[size]}
            </Chip>
          ))}
        </div>
      </Row>
    </SettingsCard>
  )
}

function MatchingSection() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  return (
    <SettingsCard
      title="Matching & timing"
      hint="how strictly attempts are judged"
    >
      <Row label="Allow octave doubling">
        <Toggle
          checked={settings.allowOctaveDoubling}
          onChange={(v) => update({ allowOctaveDoubling: v })}
          aria-label="Allow octave doubling"
        />
      </Row>
      <Row label="Strict extra notes">
        <Toggle
          checked={settings.strictExtraNotes}
          onChange={(v) => update({ strictExtraNotes: v })}
          aria-label="Strict extra notes"
        />
      </Row>
      <Row label="Judgment delay">
        <Stepper
          label="judgment delay"
          value={`${settings.judgmentDelayMs} ms`}
          decDisabled={settings.judgmentDelayMs <= 0}
          incDisabled={settings.judgmentDelayMs >= MAX_DELAY_MS}
          onDecrement={() =>
            update({ judgmentDelayMs: settings.judgmentDelayMs - 50 })
          }
          onIncrement={() =>
            update({ judgmentDelayMs: settings.judgmentDelayMs + 50 })
          }
        />
      </Row>
      <Row label="Auto-advance delay">
        <Stepper
          label="auto-advance delay"
          value={`${settings.autoAdvanceMs} ms`}
          decDisabled={settings.autoAdvanceMs <= 0}
          incDisabled={settings.autoAdvanceMs >= MAX_DELAY_MS}
          onDecrement={() =>
            update({ autoAdvanceMs: settings.autoAdvanceMs - 50 })
          }
          onIncrement={() =>
            update({ autoAdvanceMs: settings.autoAdvanceMs + 50 })
          }
        />
      </Row>
    </SettingsCard>
  )
}

function GoalSection() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)
  const setGoal = (minutes: number) => {
    update({ dailyGoalMinutes: minutes })
    practiceStore.getState().refreshGoal() // streak is derived against the goal
  }
  return (
    <SettingsCard title="Goal & unlocks" hint="what keeps the streak alive">
      <Row label="Daily goal">
        <Stepper
          label="daily goal minutes"
          value={`${settings.dailyGoalMinutes} min`}
          decDisabled={settings.dailyGoalMinutes <= 1}
          incDisabled={settings.dailyGoalMinutes >= MAX_DAILY_GOAL_MINUTES}
          onDecrement={() => setGoal(settings.dailyGoalMinutes - 5)}
          onIncrement={() => setGoal(settings.dailyGoalMinutes + 5)}
        />
      </Row>
      <Row label="Unlock in circle-of-fifths order">
        <Toggle
          checked={settings.unlockByFifths}
          onChange={(v) => {
            update({ unlockByFifths: v })
            practiceStore.getState().refreshUnlockOrder()
          }}
          aria-label="Unlock in circle-of-fifths order"
        />
      </Row>
      <p className="text-xs text-ink-muted">
        C → G → D → A … for root-ordered pools; diatonic and custom lists keep
        their own order
      </p>
    </SettingsCard>
  )
}

function LibraryRow({
  name,
  detail,
  onEdit,
  onResetProgress,
}: {
  name: string
  detail: string
  onEdit?: () => void
  onResetProgress?: () => void
}) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-track py-2 last:border-0 text-sm">
      <div className="min-w-0">
        <span className="font-semibold text-ink">{name}</span>
        <span className="ml-2 font-semibold text-ink-muted">· {detail}</span>
      </div>
      <div className="flex items-center gap-2">
        {onResetProgress && (
          <SmallButton
            onClick={onResetProgress}
            title="Restart this preset's chord unlocks at the first few chords"
          >
            Reset progress
          </SmallButton>
        )}
        {onEdit ? (
          <SmallButton onClick={onEdit}>Edit</SmallButton>
        ) : (
          <span className="text-xs text-ink-faint">built-in</span>
        )}
      </div>
    </li>
  )
}

function SmallButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded-[10px] border-2 border-muted-border px-3 py-1 text-xs font-semibold text-ink-soft transition-colors hover:text-ink"
    >
      {children}
    </button>
  )
}

function VoicingRulesSection({
  editing,
  onEdit,
  onClose,
}: {
  editing: { kind: 'rule'; rule: VoicingRule | null } | null
  onEdit: (rule: VoicingRule | null) => void
  onClose: () => void
}) {
  const customRules = useLibrary((s) => s.customRules)
  return (
    <SettingsCard
      title="Voicing rules"
      hint="two-hand patterns or bass/span/doubling specs (§3.3)"
    >
      {editing ? (
        <VoicingBuilder rule={editing.rule} onClose={onClose} />
      ) : (
        <>
          <ul className="flex flex-col">
            {BUILT_IN_VOICING_RULES.map((rule) => (
              <LibraryRow
                key={rule.id}
                name={rule.name}
                detail={describeVoicingRule(rule)}
              />
            ))}
            {customRules.map((rule) => (
              <LibraryRow
                key={rule.id}
                name={rule.name}
                detail={describeVoicingRule(rule)}
                onEdit={() => onEdit(rule)}
              />
            ))}
          </ul>
          <SmallButton onClick={() => onEdit(null)}>+ New rule</SmallButton>
        </>
      )}
    </SettingsCard>
  )
}

function describePreset(preset: Preset): string {
  const chords = poolChords(preset.pool).length
  const rules = preset.voicingIds.length
  return `${chords} chord${chords === 1 ? '' : 's'} × ${rules} rule${rules === 1 ? '' : 's'}`
}

function PresetsSection({
  editing,
  onEdit,
  onClose,
}: {
  editing: { kind: 'preset'; preset: Preset | null } | null
  onEdit: (preset: Preset | null) => void
  onClose: () => void
}) {
  const customPresets = useLibrary((s) => s.customPresets)
  const resetProgress = (presetId: string) =>
    practiceStore.getState().resetPresetProgress(presetId)

  return (
    <SettingsCard title="Presets" hint="what the generator draws from (§4)">
      {editing ? (
        <PresetEditor preset={editing.preset} onClose={onClose} />
      ) : (
        <>
          <ul className="flex flex-col">
            {builtInPresets().map((preset) => (
              <LibraryRow
                key={preset.id}
                name={preset.name}
                detail={describePreset(preset)}
                onResetProgress={() => resetProgress(preset.id)}
              />
            ))}
            {customPresets.map((preset) => (
              <LibraryRow
                key={preset.id}
                name={preset.name}
                detail={describePreset(preset)}
                onEdit={() => onEdit(preset)}
                onResetProgress={() => resetProgress(preset.id)}
              />
            ))}
          </ul>
          <SmallButton onClick={() => onEdit(null)}>+ New preset</SmallButton>
        </>
      )}
    </SettingsCard>
  )
}

function ImportExportSection() {
  const customRules = useLibrary((s) => s.customRules)
  const customPresets = useLibrary((s) => s.customPresets)
  const exportJson = useLibrary((s) => s.exportJson)
  const importJson = useLibrary((s) => s.importJson)
  const fileInput = useRef<HTMLInputElement>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  const download = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'playingchord-library.json'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setResult(importJson(await file.text()))
  }

  const empty = customRules.length === 0 && customPresets.length === 0

  return (
    <SettingsCard
      title="Import / export"
      hint="custom presets + voicing rules as JSON (§4)"
    >
      <div className="flex items-center gap-2">
        <SmallButton
          onClick={download}
          title={empty ? 'Nothing custom to export yet' : undefined}
        >
          Export library
        </SmallButton>
        <SmallButton onClick={() => fileInput.current?.click()}>
          Import…
        </SmallButton>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Import library file"
          onChange={(e) => {
            void onFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      {result && <ImportReport result={result} />}
    </SettingsCard>
  )
}

function ImportReport({ result }: { result: ImportResult }) {
  if (!result.ok) {
    return <p className="text-sm text-danger">✘ {result.error}</p>
  }
  const { plan } = result
  const added = plan.presets.length + plan.voicingRules.length
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="text-primary-light">
        ✔ Imported {plan.presets.length} preset
        {plan.presets.length === 1 ? '' : 's'}, {plan.voicingRules.length}{' '}
        voicing rule{plan.voicingRules.length === 1 ? '' : 's'}
        {added === 0 ? ' (nothing new)' : ''}
      </p>
      {plan.alreadyPresent.length > 0 && (
        <p className="text-ink-muted">
          Already present: {plan.alreadyPresent.join(', ')}
        </p>
      )}
      {plan.conflicts.length > 0 && (
        <p className="text-info-light">
          ⚠ Conflicts (kept your version): {plan.conflicts.join(', ')}
        </p>
      )}
      {plan.invalid > 0 && (
        <p className="text-ink-muted">
          {plan.invalid} invalid entr{plan.invalid === 1 ? 'y' : 'ies'} skipped
        </p>
      )}
    </div>
  )
}
