import type { ReactNode } from 'react'
import { useMidi } from '../store/midiStore'
import { Card, RaisedButton } from './ui'

// Gates the practice view behind MIDI availability (DESIGN.md §2, §6.1):
// unsupported browsers and no-device states get blocking screens — there is
// no fallback input mode. Hot-plugging a device resumes automatically, and
// the session it interrupted resumes with it (the store keeps it live across
// the Stage unmount). `onBack` is the way out when the device doesn't come
// back: it ends the session like the Stage's End button, so the gate is never
// a dead end.
export function MidiGate({
  onBack,
  children,
}: {
  onBack: () => void
  children: ReactNode
}) {
  const support = useMidi((s) => s.support)
  const hasDevice = useMidi((s) => s.activeDeviceId !== null)

  if (support === 'pending') {
    return (
      <BlockingScreen
        title="Starting…"
        body="Requesting MIDI access."
        onBack={onBack}
      />
    )
  }
  if (support === 'unsupported') {
    return (
      <BlockingScreen
        title="Web MIDI not supported"
        body="This app needs the Web MIDI API — try Chrome or Edge."
        onBack={onBack}
      />
    )
  }
  if (support === 'denied') {
    return (
      <BlockingScreen
        title="MIDI access denied"
        body="Allow MIDI access for this site in your browser, then reload."
        onBack={onBack}
      />
    )
  }
  if (!hasDevice) {
    return (
      <BlockingScreen
        title="Connect a MIDI keyboard"
        body="Plug in a MIDI keyboard to start practicing — it will be picked up automatically, and a session in progress picks up where it left off."
        onBack={onBack}
      />
    )
  }
  return <>{children}</>
}

function BlockingScreen({
  title,
  body,
  onBack,
}: {
  title: string
  body: string
  onBack: () => void
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-8 text-ink">
      <Card className="flex max-w-md flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">{title}</h1>
        <p className="text-[15px] text-ink-muted">{body}</p>
        <RaisedButton variant="outline" size="sm" onClick={onBack}>
          ← Home
        </RaisedButton>
      </Card>
    </main>
  )
}
