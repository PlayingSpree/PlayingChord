import { useMidi } from '../store/midiStore'
import { usePractice } from '../store/practiceStore'
import { pitchClass } from '../theory'

// On-screen keyboard (~3 octaves, DESIGN.md §7) showing currently held notes
// live, plus the §6.4 hint overlays. Every state pairs color with a shape:
// held = filled dot, wrong = ✕, expected (reveal) = hollow ring.
const LOW = 48 // C3
const HIGH = 84 // C6

const WHITE_PCS = new Set([0, 2, 4, 5, 7, 9, 11])
// White pitch classes that have a black key a semitone above (C D F G A).
const HAS_SHARP = new Set([0, 2, 5, 7, 9])

const WHITE_KEYS: number[] = []
for (let midi = LOW; midi <= HIGH; midi++) {
  if (WHITE_PCS.has(pitchClass(midi))) WHITE_KEYS.push(midi)
}

const NO_NOTES: ReadonlySet<number> = new Set()

// Wrong marks win over held (the offending keys are usually still down when
// the miss latches); a revealed key that gets played shows as plain held —
// visible progress through the example voicing.
type KeyState = 'idle' | 'held' | 'wrong' | 'expected'

function keyState(
  midi: number,
  held: ReadonlySet<number>,
  wrong: ReadonlySet<number>,
  expected: ReadonlySet<number>,
): KeyState {
  if (wrong.has(midi)) return 'wrong'
  if (held.has(midi)) return 'held'
  if (expected.has(midi)) return 'expected'
  return 'idle'
}

function foldIntoRange(midi: number): number {
  let m = midi
  while (m < LOW) m += 12
  while (m > HIGH) m -= 12
  return m
}

// One octave shift for the whole set, so an out-of-range note moves its
// entire shape into view instead of folding alone into the middle of it (§7).
function foldOffset(notes: readonly number[]): number {
  if (notes.length === 0) return 0
  const min = Math.min(...notes)
  const max = Math.max(...notes)
  let offset = 0
  while (min + offset < LOW) offset += 12
  while (max + offset > HIGH && min + offset - 12 >= LOW) offset -= 12
  return offset
}

// A shape wider than the drawn range can't fully fit even after the shift;
// the stragglers fold per note rather than vanish.
function foldSet(notes: readonly number[], offset: number): Set<number> {
  return new Set(notes.map((n) => foldIntoRange(n + offset)))
}

export function KeyboardView() {
  const heldNotes = useMidi((s) => s.heldNotes)
  const hint = usePractice((s) => s.hint)
  const mode = usePractice((s) => s.mode)
  const prompt = usePractice((s) => s.prompt)

  // Wrong marks sit on (recently) held keys, so they share the held set's
  // shift; the answer overlay is its own shape and folds independently.
  const wrongNotes = hint?.kind === 'wrong-keys' ? hint.notes : []
  const playedOffset = foldOffset([...heldNotes, ...wrongNotes])
  const wrong =
    wrongNotes.length > 0 ? foldSet(wrongNotes, playedOffset) : NO_NOTES
  const held = foldSet([...heldNotes], playedOffset)
  // Learn mode shows the example voicing from the start (§7) — the same
  // overlay Practice earns at the miss-3 reveal (§6.4).
  const expectedNotes =
    hint?.kind === 'reveal'
      ? hint.notes
      : mode === 'learn' && prompt !== null
        ? prompt.example
        : null
  const expected =
    expectedNotes !== null
      ? foldSet(expectedNotes, foldOffset(expectedNotes))
      : NO_NOTES
  const state = (midi: number) => keyState(midi, held, wrong, expected)

  // The keyboard is a visual instrument display; its per-key marks are
  // redundant with the feedback line's role="status" text, so screen
  // readers get one labeled image instead of ~60 unlabeled divs.
  return (
    <div className="flex justify-center overflow-x-auto">
      <div
        role="img"
        aria-label="On-screen keyboard showing held and highlighted keys"
        className="flex rounded-lg border border-slate-700 bg-slate-950 p-1.5"
      >
        {WHITE_KEYS.map((midi) => {
          const sharp = midi + 1
          const hasSharp = HAS_SHARP.has(pitchClass(midi)) && sharp <= HIGH
          return (
            <div key={midi} className="relative">
              <Key midi={midi} state={state(midi)} color="white" />
              {hasSharp && (
                <Key midi={sharp} state={state(sharp)} color="black" />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const KEY_BG = {
  white: {
    idle: 'bg-slate-100',
    held: 'bg-emerald-400',
    wrong: 'bg-rose-400',
    expected: 'bg-sky-200',
  },
  black: {
    idle: 'bg-slate-800',
    held: 'bg-emerald-500',
    wrong: 'bg-rose-500',
    expected: 'bg-sky-600',
  },
} as const

function Key({
  midi,
  state,
  color,
}: {
  midi: number
  state: KeyState
  color: 'white' | 'black'
}) {
  const base =
    color === 'white'
      ? `h-36 w-8 rounded-b border border-slate-400 sm:w-9 ${KEY_BG.white[state]}`
      : `absolute right-0 top-0 z-10 h-[5.5rem] w-5 translate-x-1/2 rounded-b border border-slate-950 ${KEY_BG.black[state]}`
  // Dark marks on light keys, light marks on dark keys (Tailwind needs the
  // class names spelled out in full to see them).
  const onWhite = color === 'white'
  return (
    <div
      className={`${base} flex items-end justify-center pb-1.5`}
      data-midi={midi}
      data-state={state === 'idle' ? undefined : state}
      data-held={state === 'held' || undefined}
    >
      {state === 'held' && (
        <span
          className={`block h-2 w-2 rounded-full ${onWhite ? 'bg-slate-900' : 'bg-slate-100'}`}
        />
      )}
      {state === 'wrong' && (
        <span
          className={`text-xs font-bold leading-none ${onWhite ? 'text-slate-900' : 'text-slate-100'}`}
        >
          ✕
        </span>
      )}
      {state === 'expected' && (
        <span
          className={`block h-2 w-2 rounded-full border-2 ${onWhite ? 'border-slate-900' : 'border-slate-100'}`}
        />
      )}
    </div>
  )
}
