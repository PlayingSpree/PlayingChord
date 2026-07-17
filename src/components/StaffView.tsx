import { useEffect, useRef } from 'react'
import VexFlow, {
  Accidental,
  Formatter,
  Renderer,
  Stave,
  StaveConnector,
  StaveNote,
  Voice,
} from 'vexflow/bravura'
import {
  grandStaffLayout,
  type Chord,
  type Clef,
  type StaffNote,
} from '../theory'

// Grand staff for the prompt's example voicing (DESIGN.md §3.4): Learn
// mode's answer display and the miss-3 reveal (§6.4). All spelling logic
// lives in theory/staff.ts — this component only turns the prepared layout
// into VexFlow calls. Default-exported for React.lazy: VexFlow (with its
// music font) is a heavy chunk that staff-off users never download.
//
// The staff sits on a light "manuscript" card so VexFlow's normal dark ink
// works inside the dark UI; the notes themselves use the same sky accent as
// the keyboard's expected-key overlay (§6.4) — one color, one meaning.

const WIDTH = 320
const HEIGHT = 240
const STAVE_X = 12
const STAVE_WIDTH = WIDTH - 2 * STAVE_X
const TREBLE_Y = 10
const BASS_Y = 100

const NOTE_STYLE = { fillStyle: '#0369a1', strokeStyle: '#0369a1' } // sky-700

// The vexflow/bravura entry starts loading its fonts at import; drawing
// before they finish would misplace every glyph, so each draw awaits the
// (already in-flight, then cached) load.
const fontsReady = () => VexFlow.loadFonts('Bravura', 'Academico')

function chordVoice(notes: StaffNote[], clef: Clef): Voice | null {
  if (notes.length === 0) return null
  const staveNote = new StaveNote({
    keys: notes.map((note) => note.key),
    duration: 'w',
    clef,
  })
  staveNote.setStyle(NOTE_STYLE)
  notes.forEach((note, index) => {
    if (note.accidental !== null) {
      staveNote.addModifier(
        new Accidental(note.accidental).setStyle(NOTE_STYLE),
        index,
      )
    }
  })
  // A default voice is 4/4; the single whole note fills it exactly.
  return new Voice().addTickables([staveNote])
}

function draw(host: HTMLDivElement, chord: Chord, notes: readonly number[]) {
  host.replaceChildren()
  const layout = grandStaffLayout(chord, notes)

  const renderer = new Renderer(host, Renderer.Backends.SVG)
  renderer.resize(WIDTH, HEIGHT)
  const context = renderer.getContext()

  const treble = new Stave(STAVE_X, TREBLE_Y, STAVE_WIDTH).addClef('treble')
  const bass = new Stave(STAVE_X, BASS_Y, STAVE_WIDTH).addClef('bass')
  treble.setContext(context).draw()
  bass.setContext(context).draw()
  new StaveConnector(treble, bass).setType('brace').setContext(context).draw()
  new StaveConnector(treble, bass)
    .setType('singleLeft')
    .setContext(context)
    .draw()

  // Format the clefs' voices together so a two-hand voicing's noteheads
  // line up vertically; an empty clef still shows its (blank) stave.
  const trebleVoice = chordVoice(layout.treble, 'treble')
  const bassVoice = chordVoice(layout.bass, 'bass')
  const voices = [trebleVoice, bassVoice].filter((v) => v !== null)
  if (voices.length === 0) return
  const formatter = new Formatter()
  for (const voice of voices) formatter.joinVoices([voice])
  formatter.formatToStave(voices, treble)
  trebleVoice?.draw(context, treble)
  bassVoice?.draw(context, bass)
}

export default function StaffView({
  chord,
  notes,
}: {
  chord: Chord
  notes: readonly number[]
}) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = host.current
    if (!element) return
    let stale = false
    void fontsReady().then(() => {
      if (!stale) draw(element, chord, notes)
    })
    return () => {
      stale = true
      element.replaceChildren()
    }
  }, [chord, notes])

  return (
    <div
      ref={host}
      role="img"
      aria-label="Example voicing on a grand staff"
      className="h-[240px] w-[320px] rounded-lg bg-slate-100 shadow-inner"
    />
  )
}
