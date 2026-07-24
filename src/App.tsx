import { useEffect, useState } from 'react'
import { midiStore } from './store/midiStore'
import { practiceStore, usePractice } from './store/practiceStore'
import { settingsStore, useSettings } from './store/settingsStore'
import { chime, metronome, piano, primeOnFirstGesture } from './audio'
import { MidiGate } from './components/MidiGate'
import { PromptCard } from './components/PromptCard'
import { KeyboardView } from './components/KeyboardView'
import { SettingsView } from './components/SettingsView'
import { UnlockToast } from './components/UnlockToast'
import { HomeView } from './components/HomeView'
import { SessionSheet } from './components/SessionSheet'
import { ReportView } from './components/ReportView'
import { ProgressView } from './components/ProgressView'
import { ChordStatsView } from './components/ChordStatsView'
import { Chip, RaisedButton } from './components/ui'
import {
  SimulatedMidiSource,
  WebMidiSource,
  attachQwertyKeys,
  type MidiSource,
} from './midi'

type View = 'home' | 'stage' | 'report' | 'progress' | 'chordStats' | 'settings'

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
  // Report when it does, wherever the transition happens.
  useEffect(() => {
    return practiceStore.subscribe((state, prev) => {
      if (state.report !== null && prev.report === null) setView('report')
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

  // Start / restart a session with the current config: clear any report and
  // remount the Stage so start() deals a fresh session (§7.2).
  const startSession = () => {
    setSheetOpen(false)
    practiceStore.getState().dismissReport()
    setSessionNonce((n) => n + 1)
    setView('stage')
  }

  // The Stage's End button (§7.2): a zero-prompt session returns Home, else
  // the Report (which the store just built).
  const endSession = () => {
    practiceStore.getState().endSession()
    setView(practiceStore.getState().report !== null ? 'report' : 'home')
  }

  const goHomeFromReport = () => {
    practiceStore.getState().dismissReport()
    setView('home')
  }

  const view$ = (() => {
    switch (view) {
      case 'stage':
        // The no-device gate (§6.1) wraps the Stage only.
        return (
          <MidiGate>
            <StageView
              key={sessionNonce}
              onEnd={endSession}
              onOpenSheet={() => setSheetOpen(true)}
            />
          </MidiGate>
        )
      case 'report':
        return <ReportView onGoAgain={startSession} onHome={goHomeFromReport} />
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
      default:
        return (
          <HomeView
            onStart={startSession}
            onOpenSheet={() => setSheetOpen(true)}
            onSettings={() => setView('settings')}
            onProgress={() => setView('progress')}
          />
        )
    }
  })()

  return (
    <>
      {view$}
      {sheetOpen && (
        <SessionSheet
          onStart={startSession}
          onClose={() => setSheetOpen(false)}
        />
      )}
      <UnlockToast />
    </>
  )
}

// The in-session Stage (§7.3). Practice pauses on unmount (leaving the Stage,
// or a remount for a fresh session) and deals a prompt on mount. The prompt
// area / keyboard get their full restyle in a later phase.
function StageView({
  onEnd,
  onOpenSheet,
}: {
  onEnd: () => void
  onOpenSheet: () => void
}) {
  useEffect(() => {
    practiceStore.getState().start()
    return () => practiceStore.getState().pause()
  }, [])

  const presets = usePractice((s) => s.presets)
  const presetId = usePractice((s) => s.presetId)
  const mode = usePractice((s) => s.mode)
  const done = usePractice((s) => s.done)
  const sessionLength = usePractice((s) => s.sessionLength)
  const progress = usePractice((s) => s.progress)
  const notPassedOnly = usePractice((s) => s.notPassedOnly)
  const song = usePractice((s) => s.song)
  const tempo = useSettings((s) => s.settings.songTempoBpm)

  const presetName = presets.find((p) => p.id === presetId)?.name ?? 'Practice'
  const modeLabel =
    mode === 'song' ? '♪ Song' : mode === 'learn' ? '🎓 Learn' : '▶ Practice'
  const lengthLabel = sessionLength === null ? '∞' : String(sessionLength)
  const pct =
    sessionLength && sessionLength > 0
      ? Math.min(100, (100 * done) / sessionLength)
      : 0

  return (
    <main className="flex min-h-screen flex-col bg-surface text-ink">
      <header className="flex items-center gap-3.5 px-6 py-4">
        <RaisedButton variant="raised" size="sm" onClick={onOpenSheet}>
          {presetName} · {modeLabel} ▾
        </RaisedButton>

        {mode === 'practice' && (
          <>
            <div className="h-3 flex-1 overflow-hidden rounded-full bg-track">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-sm font-semibold tabular-nums text-ink-muted">
              {done} / {lengthLabel}
            </span>
          </>
        )}
        {mode === 'learn' && (
          <>
            {notPassedOnly && (
              <Chip selected className="px-3 py-1.5 text-[13px]">
                not passed only ✓
              </Chip>
            )}
            <span className="flex-1" />
            <span className="flex items-center gap-1.5 text-sm font-semibold text-ink-muted">
              🔓{' '}
              <b className="text-info-light">
                {progress.unlocked}/{progress.total}
              </b>
            </span>
          </>
        )}
        {mode === 'song' && (
          <>
            <Chip className="px-3 py-1.5 text-[13px]">♩ = {tempo}</Chip>
            <Chip className="px-3 py-1.5 text-[13px]">
              loop {song ? song.loopIndex + 1 : 1}
            </Chip>
            <span className="flex-1" />
          </>
        )}

        <RaisedButton variant="outline" size="sm" onClick={onEnd}>
          End
        </RaisedButton>
      </header>

      <div className="flex flex-1 items-center justify-center px-6 py-8">
        <PromptCard />
      </div>

      <footer className="px-4 pb-8">
        <KeyboardView />
      </footer>
    </main>
  )
}
