import { useMidi } from '../store/midiStore'
import { usePractice } from '../store/practiceStore'
import { useSettings } from '../store/settingsStore'
import { MODE_POLICY } from '../practice'
import { pitchClass } from '../theory'

// On-screen keyboard (~3 octaves, DESIGN.md §7) showing currently held notes
// live, plus the §6.4 hint overlays. Every state pairs color with a shape:
// held = filled dot, wrong = ✕, expected (reveal) = hollow ring, and for a
// scale run (§6.6) played-so-far = ✓ and Learn's next key = ▲.
const LOW = 48 // C3
const HIGH = 84 // C6

const WHITE_PCS = new Set([0, 2, 4, 5, 7, 9, 11])
// White pitch classes that have a black key a semitone above (C D F G A).
const HAS_SHARP = new Set([0, 2, 5, 7, 9])

interface Range {
  low: number
  high: number
}

const DEFAULT_RANGE: Range = { low: LOW, high: HIGH }

function whiteKeys({ low, high }: Range): number[] {
  const keys: number[] = []
  for (let midi = low; midi <= high; midi++) {
    if (WHITE_PCS.has(pitchClass(midi))) keys.push(midi)
  }
  return keys
}

// A run never folds — folding would scramble the very order being drilled
// (§7.3) — so the drawn range widens to hold every note of it, out to whole
// octaves (C to C) so the keyboard still reads as one.
function rangeFor(run: readonly number[] | null): Range {
  if (run === null || run.length === 0) return DEFAULT_RANGE
  const min = Math.min(...run)
  const max = Math.max(...run)
  const low = Math.min(LOW, min - pitchClass(min))
  const high = Math.max(HIGH, max + ((12 - pitchClass(max)) % 12))
  return { low, high }
}

const NO_NOTES: ReadonlySet<number> = new Set()

// Wrong marks win over held (the offending keys are usually still down when
// the miss latches); a revealed key that gets played shows as plain held —
// visible progress through the example voicing. On a run, Learn's next key
// wins over the notes already played, which an up-and-down run revisits.
type KeyState = 'idle' | 'held' | 'wrong' | 'next' | 'done' | 'expected'

interface Marks {
  held: ReadonlySet<number>
  wrong: ReadonlySet<number>
  next: ReadonlySet<number>
  done: ReadonlySet<number>
  expected: ReadonlySet<number>
}

function keyState(midi: number, marks: Marks): KeyState {
  if (marks.wrong.has(midi)) return 'wrong'
  if (marks.held.has(midi)) return 'held'
  if (marks.next.has(midi)) return 'next'
  if (marks.done.has(midi)) return 'done'
  if (marks.expected.has(midi)) return 'expected'
  return 'idle'
}

function foldIntoRange(midi: number, { low, high }: Range): number {
  let m = midi
  while (m < low) m += 12
  while (m > high) m -= 12
  return m
}

// One octave shift for the whole set, so an out-of-range note moves its
// entire shape into view instead of folding alone into the middle of it (§7).
function foldOffset(notes: readonly number[], { low, high }: Range): number {
  if (notes.length === 0) return 0
  const min = Math.min(...notes)
  const max = Math.max(...notes)
  let offset = 0
  while (min + offset < low) offset += 12
  while (max + offset > high && min + offset - 12 >= low) offset -= 12
  return offset
}

// A shape wider than the drawn range can't fully fit even after the shift;
// the stragglers fold per note rather than vanish.
function foldSet(
  notes: readonly number[],
  offset: number,
  range: Range,
): Set<number> {
  return new Set(notes.map((n) => foldIntoRange(n + offset, range)))
}

export function KeyboardView() {
  const heldNotes = useMidi((s) => s.heldNotes)
  const hint = usePractice((s) => s.hint)
  const mode = usePractice((s) => s.mode)
  const prompt = usePractice((s) => s.prompt)
  const run = usePractice((s) => s.run)
  const songShowExample = useSettings((s) => s.settings.songShowExample)

  const range = rangeFor(run?.notes ?? null)
  const learn = MODE_POLICY[mode].revealsAnswer

  // Wrong marks sit on (recently) held keys, so they share the held set's
  // shift; the answer overlay is its own shape and folds independently.
  const wrongNotes = hint?.kind === 'wrong-keys' ? hint.notes : []
  const playedOffset = foldOffset([...heldNotes, ...wrongNotes], range)
  const wrong =
    wrongNotes.length > 0 ? foldSet(wrongNotes, playedOffset, range) : NO_NOTES
  const held = foldSet([...heldNotes], playedOffset, range)

  // A run is drawn where it is played, never shifted: the range already
  // holds it. It shows how far it has got throughout, without previewing the
  // next note — except in Learn, which overlays the whole run from the start
  // and marks the next key as it advances (§6.6).
  if (run !== null) {
    const next = run.notes[run.played]
    const expected =
      hint?.kind === 'reveal'
        ? new Set(hint.notes)
        : learn
          ? new Set(run.notes)
          : NO_NOTES
    const marks: Marks = {
      held,
      wrong,
      next: learn && next !== undefined ? new Set([next]) : NO_NOTES,
      done: new Set(run.notes.slice(0, run.played)),
      expected,
    }
    return <Keys range={range} marks={marks} />
  }

  // Learn mode shows the example voicing from the start (§7) — the same
  // overlay Practice earns at the miss-3 reveal (§6.4). Song mode overlays
  // each bar's example too while its show-example setting is on (§6.5).
  const expectedNotes =
    hint?.kind === 'reveal'
      ? hint.notes
      : prompt !== null && (learn || (mode === 'song' && songShowExample))
        ? prompt.example
        : null
  const expected =
    expectedNotes !== null
      ? foldSet(expectedNotes, foldOffset(expectedNotes, range), range)
      : NO_NOTES
  const marks: Marks = {
    held,
    wrong,
    next: NO_NOTES,
    done: NO_NOTES,
    expected,
  }
  return <Keys range={range} marks={marks} />
}

function Keys({ range, marks }: { range: Range; marks: Marks }) {
  // The keyboard is a visual instrument display; its per-key marks are
  // redundant with the feedback line's role="status" text, so screen
  // readers get one labeled image instead of ~60 unlabeled divs.
  return (
    <div className="flex justify-center overflow-x-auto">
      <div
        role="img"
        aria-label="On-screen keyboard showing held and highlighted keys"
        className="flex rounded-2xl border-2 border-card-border bg-keybed p-2 shadow-hard"
      >
        {whiteKeys(range).map((midi) => {
          const sharp = midi + 1
          const hasSharp =
            HAS_SHARP.has(pitchClass(midi)) && sharp <= range.high
          return (
            <div key={midi} className="relative">
              <Key midi={midi} state={keyState(midi, marks)} color="white" />
              {hasSharp && (
                <Key
                  midi={sharp}
                  state={keyState(sharp, marks)}
                  color="black"
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Prototype key colors (§7.3): a warm off-white bed, green held, red wrong,
// pale-green expected; a run's played notes a muted green and Learn's next
// key sky, the expected-key accent the staff uses too. Feedback never rides
// on color alone — each state also carries a mark (dot / ✕ / ring / ✓ / ▲).
const KEY_BG = {
  white: {
    idle: 'bg-[#eceaf6]',
    held: 'bg-[#8ee653]',
    wrong: 'bg-[#ff8080]',
    next: 'bg-[#7dd3fc]',
    done: 'bg-[#c3dfb0]',
    expected: 'bg-[#d9f2c4]',
  },
  black: {
    idle: 'bg-track',
    held: 'bg-primary',
    wrong: 'bg-[#d94f4f]',
    next: 'bg-[#0369a1]',
    done: 'bg-[#3d5a2b]',
    expected: 'bg-[#41682a]',
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
      ? `h-36 w-8 rounded-b border border-[#41466e] sm:w-9 ${KEY_BG.white[state]}`
      : `absolute right-0 top-0 z-10 h-[5.5rem] w-5 translate-x-1/2 rounded-b shadow-[0_0_0_1px_var(--color-keybed)] ${KEY_BG.black[state]}`
  // Dark marks on light keys, light marks on dark keys (Tailwind needs the
  // class names spelled out in full to see them).
  const onWhite = color === 'white'
  const text = `text-xs font-bold leading-none ${onWhite ? 'text-slate-900' : 'text-slate-100'}`
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
      {state === 'wrong' && <span className={text}>✕</span>}
      {state === 'done' && <span className={text}>✓</span>}
      {state === 'next' && <span className={text}>▲</span>}
      {state === 'expected' && (
        <span
          className={`block h-2 w-2 rounded-full border-2 ${onWhite ? 'border-slate-900' : 'border-slate-100'}`}
        />
      )}
    </div>
  )
}
