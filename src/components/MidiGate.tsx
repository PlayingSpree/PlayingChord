import type { ReactNode } from 'react'
import { useMidi } from '../store/midiStore'

// Gates the practice view behind MIDI availability (DESIGN.md §2, §6.1):
// unsupported browsers and no-device states get blocking screens — there is
// no fallback input mode. Hot-plugging a device resumes automatically.
export function MidiGate({ children }: { children: ReactNode }) {
  const support = useMidi((s) => s.support)
  const hasDevice = useMidi((s) => s.activeDeviceId !== null)

  if (support === 'pending') {
    return <BlockingScreen title="Starting…" body="Requesting MIDI access." />
  }
  if (support === 'unsupported') {
    return (
      <BlockingScreen
        title="Web MIDI not supported"
        body="This app needs the Web MIDI API — try Chrome or Edge."
      />
    )
  }
  if (support === 'denied') {
    return (
      <BlockingScreen
        title="MIDI access denied"
        body="Allow MIDI access for this site in your browser, then reload."
      />
    )
  }
  if (!hasDevice) {
    return (
      <BlockingScreen
        title="Connect a MIDI keyboard"
        body="Plug in a MIDI keyboard to start practicing — it will be picked up automatically."
      />
    )
  }
  return <>{children}</>
}

function BlockingScreen({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-8 text-slate-100">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-bold">{title}</h1>
        <p className="mt-4 text-slate-400">{body}</p>
      </div>
    </main>
  )
}
