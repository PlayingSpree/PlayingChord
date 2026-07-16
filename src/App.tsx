import { useEffect } from 'react'
import { midiStore } from './store/midiStore'
import { practiceStore } from './store/practiceStore'
import { MidiGate } from './components/MidiGate'
import { DevicePicker } from './components/DevicePicker'
import { PresetPicker } from './components/PresetPicker'
import { PromptCard } from './components/PromptCard'
import { KeyboardView } from './components/KeyboardView'
import { SettingsPanel } from './components/SettingsPanel'
import { StatsBar } from './components/StatsBar'
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
  useEffect(() => {
    void midiStore.getState().initialize(createSource())
    // Every held-set change is judged (§6.2); the stores stay decoupled —
    // practice knows nothing about MIDI, only about held-note sets.
    return midiStore.subscribe((state, prev) => {
      if (state.heldNotes !== prev.heldNotes) {
        practiceStore.getState().onHeldChange(state.heldNotes)
      }
    })
  }, [])

  return (
    <MidiGate>
      <PracticeView />
    </MidiGate>
  )
}

// Mode picker and goals join the top bar in Phase 7 (§7).
function PracticeView() {
  useEffect(() => {
    practiceStore.getState().start()
  }, [])

  return (
    <main className="flex min-h-screen flex-col bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between gap-4 border-b border-slate-800 px-6 py-3">
        <h1 className="text-lg font-bold tracking-tight">PlayingChord</h1>
        <div className="flex items-center gap-4">
          <PresetPicker />
          <DevicePicker />
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
    </main>
  )
}
