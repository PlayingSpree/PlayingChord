import { useEffect } from 'react'
import { midiStore, useMidi } from './store/midiStore'
import { MidiGate } from './components/MidiGate'
import { DevicePicker } from './components/DevicePicker'
import {
  SimulatedMidiSource,
  WebMidiSource,
  attachQwertyKeys,
  type MidiSource,
} from './midi'
import { formatSpelling, pitchClass, spellRoot } from './theory'

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
  }, [])

  return (
    <MidiGate>
      <MidiDebugView />
    </MidiGate>
  )
}

// Phase 2 scaffolding view — replaced by the practice screen in Phase 3.
function MidiDebugView() {
  const heldNotes = useMidi((s) => s.heldNotes)
  const notes = [...heldNotes].sort((a, b) => a - b)

  return (
    <main className="min-h-screen bg-slate-900 p-8 text-slate-100">
      <div className="mx-auto max-w-2xl">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">
            PlayingChord{' '}
            <span className="font-normal text-slate-400">MIDI debug</span>
          </h1>
          <DevicePicker />
        </header>

        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            Held notes
          </h2>
          <div className="mt-3 flex min-h-16 flex-wrap items-start gap-2">
            {notes.length === 0 ? (
              <p className="text-slate-500">Play something…</p>
            ) : (
              notes.map((note) => (
                <span
                  key={note}
                  className="rounded-lg bg-emerald-700 px-3 py-2 font-mono text-lg"
                >
                  {noteLabel(note)}{' '}
                  <span className="text-emerald-300">({note})</span>
                </span>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

function noteLabel(midi: number): string {
  return `${formatSpelling(spellRoot(pitchClass(midi)))}${Math.floor(midi / 12) - 1}`
}
