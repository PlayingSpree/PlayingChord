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
import { NumberField, SelectField, Toggle } from './fields'
import { VoicingBuilder } from './VoicingBuilder'
import { PresetEditor } from './PresetEditor'

// The §7 settings screen: every toggle/delay/goal in one place, plus the
// Phase 9 library — voicing builder, preset editor, JSON import/export —
// and the Phase 8 staff/chime toggles.

type Editing =
  | { kind: 'rule'; rule: VoicingRule | null } // null = new
  | { kind: 'preset'; preset: Preset | null }
  | null

export function SettingsView({ onBack }: { onBack: () => void }) {
  const [editing, setEditing] = useState<Editing>(null)

  return (
    <main className="flex min-h-screen flex-col bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between gap-4 border-b border-slate-800 px-6 py-3">
        <h1 className="text-lg font-bold tracking-tight">
          PlayingChord{' '}
          <span className="font-normal text-slate-400">— Settings</span>
        </h1>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
        >
          ← Practice
        </button>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8">
        <MatchingSection />
        <NotationSoundSection />
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

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section aria-label={title}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-300">{title}</h3>
        {hint && <span className="text-xs text-slate-500">{hint}</span>}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function MatchingSection() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)

  return (
    <Section title="Matching & timing">
      <div className="flex max-w-md flex-col gap-3">
        <Toggle
          label="Allow octave doubling"
          checked={settings.allowOctaveDoubling}
          onChange={(v) => update({ allowOctaveDoubling: v })}
        />
        <Toggle
          label="Strict extra notes"
          checked={settings.strictExtraNotes}
          onChange={(v) => update({ strictExtraNotes: v })}
        />
        <NumberField
          label="Judgment delay (ms)"
          value={settings.judgmentDelayMs}
          min={0}
          max={MAX_DELAY_MS}
          step={50}
          onChange={(v) => update({ judgmentDelayMs: v })}
        />
        <NumberField
          label="Auto-advance delay (ms)"
          value={settings.autoAdvanceMs}
          min={0}
          max={MAX_DELAY_MS}
          step={50}
          onChange={(v) => update({ autoAdvanceMs: v })}
        />
        <NumberField
          label="Daily goal (minutes)"
          value={settings.dailyGoalMinutes}
          min={1}
          max={MAX_DAILY_GOAL_MINUTES}
          step={5}
          onChange={(v) => {
            update({ dailyGoalMinutes: v })
            // Streak/goal state is derived against the current goal.
            practiceStore.getState().refreshGoal()
          }}
        />
      </div>
    </Section>
  )
}

const CHORD_NAME_SIZE_LABELS: Record<ChordNameSize, string> = {
  sm: 'Small',
  md: 'Medium',
  lg: 'Large (default)',
  xl: 'Extra large',
}

function NotationSoundSection() {
  const settings = useSettings((s) => s.settings)
  const update = useSettings((s) => s.update)

  return (
    <Section
      title="Notation & sound"
      hint="staff scopes to Learn mode & reveals (§7); the chime is the only sound (§9)"
    >
      <div className="flex max-w-md flex-col gap-3">
        <SelectField
          label="Chord name size"
          value={settings.chordNameSize}
          options={CHORD_NAME_SIZES.map((size) => ({
            value: size,
            label: CHORD_NAME_SIZE_LABELS[size],
          }))}
          onChange={(v) => update({ chordNameSize: v })}
        />
        <Toggle
          label="Show staff notation"
          checked={settings.staffEnabled}
          onChange={(v) => update({ staffEnabled: v })}
        />
        <Toggle
          label="Chime on correct"
          checked={settings.chimeEnabled}
          onChange={(v) => update({ chimeEnabled: v })}
        />
      </div>
    </Section>
  )
}

function LibraryRow({
  name,
  detail,
  onEdit,
}: {
  name: string
  detail: string
  onEdit?: () => void // absent for built-ins
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <span className="text-sm text-slate-200">{name}</span>
        <span className="ml-2 text-xs text-slate-500">{detail}</span>
      </div>
      {onEdit ? (
        <button
          type="button"
          onClick={onEdit}
          className="rounded-md border border-slate-700 px-2.5 py-0.5 text-xs text-slate-300 transition-colors hover:border-slate-500"
        >
          Edit
        </button>
      ) : (
        <span className="text-xs text-slate-600">built-in</span>
      )}
    </li>
  )
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
    >
      + {label}
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
    <Section
      title="Voicing rules"
      hint="two-hand patterns, or reusable bass/span/doubling specs (§3.3)"
    >
      {editing ? (
        <VoicingBuilder rule={editing.rule} onClose={onClose} />
      ) : (
        <>
          <ul className="divide-y divide-slate-800">
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
          <AddButton label="New voicing rule" onClick={() => onEdit(null)} />
        </>
      )}
    </Section>
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

  return (
    <Section title="Presets" hint="what the generator draws from (§4)">
      {editing ? (
        <PresetEditor preset={editing.preset} onClose={onClose} />
      ) : (
        <>
          <ul className="divide-y divide-slate-800">
            {builtInPresets().map((preset) => (
              <LibraryRow
                key={preset.id}
                name={preset.name}
                detail={describePreset(preset)}
              />
            ))}
            {customPresets.map((preset) => (
              <LibraryRow
                key={preset.id}
                name={preset.name}
                detail={describePreset(preset)}
                onEdit={() => onEdit(preset)}
              />
            ))}
          </ul>
          <AddButton label="New preset" onClick={() => onEdit(null)} />
        </>
      )}
    </Section>
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
    <Section
      title="Import / export"
      hint="custom presets + voicing rules as JSON (§4)"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={download}
          disabled={empty}
          title={empty ? 'Nothing custom to export yet' : undefined}
          className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-300 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-600"
        >
          Export library
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="rounded-md border border-slate-700 px-3 py-1 text-sm text-slate-300 transition-colors hover:border-slate-500"
        >
          Import…
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          className="hidden"
          aria-label="Import library file"
          onChange={(e) => {
            void onFile(e.target.files?.[0])
            e.target.value = '' // allow re-importing the same file
          }}
        />
      </div>
      {result && <ImportReport result={result} />}
    </Section>
  )
}

function ImportReport({ result }: { result: ImportResult }) {
  if (!result.ok) {
    return <p className="mt-3 text-sm text-rose-400">✘ {result.error}</p>
  }
  const { plan } = result
  const added = plan.presets.length + plan.voicingRules.length
  return (
    <div className="mt-3 flex flex-col gap-1 text-sm">
      <p className="text-emerald-400">
        ✔ Imported {plan.presets.length} preset
        {plan.presets.length === 1 ? '' : 's'}, {plan.voicingRules.length}{' '}
        voicing rule{plan.voicingRules.length === 1 ? '' : 's'}
        {added === 0 ? ' (nothing new)' : ''}
      </p>
      {plan.alreadyPresent.length > 0 && (
        <p className="text-slate-400">
          Already present: {plan.alreadyPresent.join(', ')}
        </p>
      )}
      {plan.conflicts.length > 0 && (
        <p className="text-amber-400">
          ⚠ Conflicts (kept your version): {plan.conflicts.join(', ')}
        </p>
      )}
      {plan.invalid > 0 && (
        <p className="text-slate-400">
          {plan.invalid} invalid entr{plan.invalid === 1 ? 'y' : 'ies'} skipped
        </p>
      )}
    </div>
  )
}
