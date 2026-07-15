import { useMidi } from '../store/midiStore'
import { pitchClass } from '../theory'

// On-screen keyboard (~3 octaves, DESIGN.md §7) showing currently held notes
// live. Hint/miss overlays arrive in Phase 4; held keys already use color
// plus a dot marker so state never relies on color alone (§6.4).
const LOW = 48 // C3
const HIGH = 84 // C6

const WHITE_PCS = new Set([0, 2, 4, 5, 7, 9, 11])
// White pitch classes that have a black key a semitone above (C D F G A).
const HAS_SHARP = new Set([0, 2, 5, 7, 9])

const WHITE_KEYS: number[] = []
for (let midi = LOW; midi <= HIGH; midi++) {
  if (WHITE_PCS.has(pitchClass(midi))) WHITE_KEYS.push(midi)
}

export function KeyboardView() {
  const heldNotes = useMidi((s) => s.heldNotes)

  return (
    <div className="flex justify-center overflow-x-auto">
      <div className="flex rounded-lg border border-slate-700 bg-slate-950 p-1.5">
        {WHITE_KEYS.map((midi) => {
          const sharp = midi + 1
          const hasSharp = HAS_SHARP.has(pitchClass(midi)) && sharp <= HIGH
          return (
            <div key={midi} className="relative">
              <Key midi={midi} held={heldNotes.has(midi)} color="white" />
              {hasSharp && (
                <Key midi={sharp} held={heldNotes.has(sharp)} color="black" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Key({
  midi,
  held,
  color,
}: {
  midi: number
  held: boolean
  color: 'white' | 'black'
}) {
  const base =
    color === 'white'
      ? `h-36 w-8 rounded-b border border-slate-400 sm:w-9 ${
          held ? 'bg-emerald-400' : 'bg-slate-100'
        }`
      : `absolute right-0 top-0 z-10 h-[5.5rem] w-5 translate-x-1/2 rounded-b border border-slate-950 ${
          held ? 'bg-emerald-500' : 'bg-slate-800'
        }`
  return (
    <div
      className={`${base} flex items-end justify-center pb-1.5`}
      data-midi={midi}
      data-held={held || undefined}
    >
      {held && (
        <span
          className={`block h-2 w-2 rounded-full ${
            color === 'white' ? 'bg-slate-900' : 'bg-slate-100'
          }`}
        />
      )}
    </div>
  )
}
