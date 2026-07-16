import { useEffect, useState } from 'react'
import { midiStore } from './store/midiStore'
import { practiceStore } from './store/practiceStore'
import { MidiGate } from './components/MidiGate'
import { DevicePicker } from './components/DevicePicker'
import { PresetPicker } from './components/PresetPicker'
import { PromptCard } from './components/PromptCard'
import { KeyboardView } from './components/KeyboardView'
import { SettingsPanel } from './components/SettingsPanel'
import { StatsBar } from './components/StatsBar'
import { ModeBar } from './components/ModeBar'
import { GoalChip } from './components/GoalChip'
import { SessionSummaryModal } from './components/SessionSummaryModal'
import { HistoryView } from './components/HistoryView'
import {
  SimulatedMidiSource,
  WebMidiSource,
  attachQwertyKeys,
  type MidiSource,
} from './midi'

function createSource(): MidiSource {
  const wantSim =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('midi') === 'sim'
  if (wantSim) {
    const sim = new SimulatedMidiSource([
      { id: 'sim', name: 'Simulated keyboard (QWERTY A–P)' },
    ])
    attachQwertyKeys(sim)
    return sim
  }
  return new WebMidiSource()
}

export default function App() {
  const [view, setView] = useState<'practice' | 'history'>('practice')

  useEffect(() => {
    void midiStore.getState().initialize(createSource())
    // Every held-set change is judged (§6.2) and feeds active-time tracking
    // (§7); the stores stay decoupled — practice knows nothing about MIDI,
    // only about held-note sets.
    return midiStore.subscribe((state, prev) => {
      if (state.heldNotes !== prev.heldNotes) {
        practiceStore.getState().onHeldChange(state.heldNotes)
      }
    })
  }, [])

  return (
    <MidiGate>
      {view === 'practice' ? (
        <PracticeView onHistory={() => setView('history')} />
      ) : (
        <HistoryView onBack={() => setView('practice')} />
      )}
    </MidiGate>
  )
}

function PracticeView({ onHistory }: { onHistory: () => void }) {
  // Practice pauses while the History view is open (unmount) and deals a
  // fresh prompt on return.
  useEffect(() => {
    practiceStore.getState().start()
    return () => practiceStore.getState().pause()
  }, [])

  return (
    <main className="flex min-h-screen flex-col bg-slate-900 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-slate-800 px-6 py-3">
        <h1 className="text-lg font-bold tracking-tight">PlayingChord</h1>
        <div className="flex flex-wrap items-center gap-3">
          <PresetPicker />
          <ModeBar />
          <DevicePicker />
          <GoalChip />
          <button
            type="button"
            onClick={onHistory}
            className="rounded-md border border-slate-700 px-2.5 py-1 text-sm text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
          >
            History
          </button>
          <SettingsPanel />
        </div>
      </header>

      <div className="flex flex-1 items-center justify-center px-6 py-8">
        <PromptCard />
      </div>

      <footer className="pb-8">
        <StatsBar />
        <div className="px-4 pt-2">
          <KeyboardView />
        </div>
      </footer>

      <SessionSummaryModal />
    </main>
  )
}
