import { useEffect, useState } from 'react'
import { midiStore } from './store/midiStore'
import { practiceStore } from './store/practiceStore'
import { settingsStore } from './store/settingsStore'
import { chime, metronome, piano, primeOnFirstGesture } from './audio'
import { MidiGate } from './components/MidiGate'
import { DevicePicker } from './components/DevicePicker'
import { PresetPicker } from './components/PresetPicker'
import { PromptCard } from './components/PromptCard'
import { KeyboardView } from './components/KeyboardView'
import { SettingsView } from './components/SettingsView'
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

// Module-level singleton, like the stores: a source created per mount would
// mean the piano-sound effect's subscription (below) and midiStore's own
// initialize() could end up on two different instances under StrictMode's
// double-invoke.
const midiSource = createSource()

export default function App() {
  const [view, setView] = useState<'practice' | 'history' | 'settings'>(
    'practice',
  )

  useEffect(() => {
    void midiStore.getState().initialize(midiSource)
    // Every held-set change is judged (§6.2) and feeds active-time tracking
    // (§7); the stores stay decoupled — practice knows nothing about MIDI,
    // only about held-note sets.
    return midiStore.subscribe((state, prev) => {
      if (state.heldNotes !== prev.heldNotes) {
        practiceStore.getState().onHeldChange(state.heldNotes)
      }
      // A device switch (or unplug) means the old device's noteOffs will
      // never arrive — silence anything still ringing from it.
      if (state.activeDeviceId !== prev.activeDeviceId) {
        piano.allNotesOff()
      }
    })
  }, [])

  useEffect(() => {
    // Chime + piano wiring both live at this edge like MIDI (§8). The
    // context is primed on the first gesture because autoplay policy
    // doesn't count MIDI input as one, and priming is shared between both
    // instruments (§9).
    const unprime = primeOnFirstGesture()

    // Correct-chime: the transition into 'advancing' is exactly the ✔
    // moment (§6.2) — skips never pass through it. Fire-and-forget, so the
    // flash never waits on audio. Song mode (§6.5) never enters 'advancing';
    // its beats drive the metronome click and a bar's first match plays the
    // same ✔ chime, both keyed off the engine's monotonic counters.
    const unsubscribePractice = practiceStore.subscribe((state, prev) => {
      const chimeEnabled = () => settingsStore.getState().settings.chimeEnabled
      if (
        state.phase === 'advancing' &&
        prev.phase !== 'advancing' &&
        chimeEnabled()
      ) {
        chime.play()
      }
      if (state.song !== null) {
        if (state.song.beat !== prev.song?.beat) {
          metronome.tick(state.song.beatInBar === 0)
        }
        if (
          prev.song !== null &&
          state.song.hitCount > prev.song.hitCount &&
          chimeEnabled()
        ) {
          chime.play()
        }
      }
    })

    // Piano: voices the user's own key presses with velocity (§9); noteOff
    // always forwards regardless of the setting so toggling it off mid-hold
    // can't leave a note ringing.
    const unsubscribeMidi = midiSource.subscribe((event) => {
      if (event.kind === 'noteOn') {
        if (settingsStore.getState().settings.pianoSoundEnabled) {
          piano.noteOn(event.note, event.velocity)
        }
      } else if (event.kind === 'noteOff') {
        piano.noteOff(event.note)
      }
    })

    return () => {
      unprime()
      unsubscribePractice()
      unsubscribeMidi()
    }
  }, [])

  return (
    <MidiGate>
      {view === 'practice' ? (
        <PracticeView
          onHistory={() => setView('history')}
          onSettings={() => setView('settings')}
        />
      ) : view === 'history' ? (
        <HistoryView onBack={() => setView('practice')} />
      ) : (
        <SettingsView onBack={() => setView('practice')} />
      )}
    </MidiGate>
  )
}

function PracticeView({
  onHistory,
  onSettings,
}: {
  onHistory: () => void
  onSettings: () => void
}) {
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
          <button
            type="button"
            onClick={onSettings}
            className="rounded-md border border-slate-700 px-2.5 py-1 text-sm text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
          >
            ⚙ Settings
          </button>
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
