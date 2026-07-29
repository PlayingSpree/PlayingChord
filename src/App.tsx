import { useEffect, useState } from 'react'
import { midiStore } from './store/midiStore'
import { practiceStore } from './store/practiceStore'
import { settingsStore } from './store/settingsStore'
import { chime, metronome, piano, primeOnFirstGesture } from './audio'
import { MidiGate } from './components/MidiGate'
import { SettingsView } from './components/SettingsView'
import { StageView } from './components/StageView'
import { PathMapView } from './components/PathMapView'
import type { StartIntent } from './components/TodayCard'
import { Toasts } from './components/Toasts'
import { HomeView } from './components/HomeView'
import { SessionSheet } from './components/SessionSheet'
import { ReportView } from './components/ReportView'
import { ProgressView } from './components/ProgressView'
import { ChordStatsView } from './components/ChordStatsView'
import {
  SimulatedMidiSource,
  WebMidiSource,
  attachQwertyKeys,
  type MidiSource,
} from './midi'

type View =
  'home' | 'stage' | 'report' | 'progress' | 'chordStats' | 'settings' | 'path'

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
  const [view, setView] = useState<View>('home')
  const [sheetOpen, setSheetOpen] = useState(false)
  // Bumping this remounts the Stage, so Start / Go again always begin a fresh
  // session (start() resets on mount) even from an already-running Stage.
  const [sessionNonce, setSessionNonce] = useState(0)

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

  // A session that reaches its length ends itself (§7.2) — route to the
  // Report when it does, wherever the transition happens. The sheet closes
  // with it so it can never be left stacked over the Report.
  useEffect(() => {
    return practiceStore.subscribe((state, prev) => {
      if (state.report !== null && prev.report === null) {
        setSheetOpen(false)
        setView('report')
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
    // moment (§6.2). Fire-and-forget, so the
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

  // Start / restart a session, and *what kind* — the Today card's four states
  // and the free-practice sheet all land here (§4.1). Each intent configures the
  // store before the Stage mounts, then the nonce remounts it so start() deals a
  // fresh session (§7.2). An intent the path can't honour right now (a stale
  // Today card whose batch finished elsewhere) returns false and leaves the
  // player where they were rather than opening an empty Stage.
  const startSession = (
    intent: StartIntent = 'free',
    chapterId?: string,
  ): void => {
    const store = practiceStore.getState()
    setSheetOpen(false)
    store.dismissReport()
    if (intent === 'path-learn' && !store.startPathLearn()) return
    if (intent === 'repertoire' && !store.startRepertoire()) return
    if (
      intent === 'chapter-song' &&
      (chapterId === undefined || !store.startChapterSong(chapterId))
    ) {
      return
    }
    // Free practice keeps whatever the sheet drafted; the path intents have
    // already discarded anything in flight themselves.
    if (intent === 'free') practiceStore.getState().discardSession()
    setSessionNonce((n) => n + 1)
    setView('stage')
  }

  // The Stage's End button (§7.2, and the MIDI gate's way back, §6.1): a
  // zero-prompt session returns Home, else the Report (which the store just
  // built).
  const endSession = () => {
    practiceStore.getState().endSession()
    setView(practiceStore.getState().report !== null ? 'report' : 'home')
  }

  // The session sheet pauses the session it's opened over (§7.2): judging
  // stops behind the modal, and closing it without starting resumes the same
  // session — count and tallies intact, a fresh prompt dealt.
  const openSheet = () => {
    if (view === 'stage') practiceStore.getState().pause()
    setSheetOpen(true)
  }

  const closeSheet = () => {
    setSheetOpen(false)
    if (view === 'stage') practiceStore.getState().start()
  }

  const goHomeFromReport = () => {
    practiceStore.getState().dismissReport()
    setView('home')
  }

  const view$ = (() => {
    switch (view) {
      case 'stage':
        // The no-device gate (§6.1) wraps the Stage only; its way out ends the
        // session like the End button, so an unplug is never a dead end. A
        // device coming back remounts the Stage, which resumes the session.
        return (
          <MidiGate onBack={endSession}>
            <StageView
              key={sessionNonce}
              onEnd={endSession}
              onOpenSheet={openSheet}
            />
          </MidiGate>
        )
      case 'report':
        return (
          <ReportView
            onGoAgain={startSession}
            onHome={goHomeFromReport}
            onStart={startSession}
          />
        )
      case 'progress':
        return (
          <ProgressView
            onBack={() => setView('home')}
            onChordStats={() => setView('chordStats')}
          />
        )
      case 'chordStats':
        return <ChordStatsView onBack={() => setView('progress')} />
      case 'settings':
        return <SettingsView onBack={() => setView('home')} />
      case 'path':
        return <PathMapView onBack={() => setView('home')} />
      default:
        return (
          <HomeView
            onStart={startSession}
            onFreePractice={openSheet}
            onSettings={() => setView('settings')}
            onProgress={() => setView('progress')}
            onPathMap={() => setView('path')}
          />
        )
    }
  })()

  return (
    <>
      {view$}
      {sheetOpen && (
        <SessionSheet onStart={startSession} onClose={closeSheet} />
      )}
      <Toasts />
    </>
  )
}
