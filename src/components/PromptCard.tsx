import { lazy, Suspense } from 'react'
import { usePractice } from '../store/practiceStore'
import { useSettings } from '../store/settingsStore'
import {
  FIRST_TRY_STREAK_DISPLAY_MIN,
  FAST_TIME_MS,
  MAX_TIME_TO_CORRECT_MS,
  SLOW_TIME_MS,
  type ChordNameSize,
  type Hint,
} from '../practice'
import { cx } from './cx'

// VexFlow + music font are a heavy chunk; staff-off users (a first-class
// way to run the app, §3.4) never download it.
const StaffView = lazy(() => import('./StaffView'))

// Tailwind classes per chord-name size setting (§7); 'lg' matches the
// original fixed size.
const CHORD_NAME_SIZE_CLASSES: Record<ChordNameSize, string> = {
  sm: 'text-5xl sm:text-6xl',
  md: 'text-6xl sm:text-7xl',
  lg: 'text-7xl sm:text-8xl',
  xl: 'text-8xl sm:text-9xl',
}

// The inline next-2 preview (§7.3) scales with the name so it stays readable
// from the same distance — the next one larger than the one after it.
const PREVIEW_NEXT: Record<ChordNameSize, string> = {
  sm: 'text-2xl',
  md: 'text-3xl',
  lg: 'text-4xl',
  xl: 'text-5xl',
}
const PREVIEW_AFTER: Record<ChordNameSize, string> = {
  sm: 'text-lg',
  md: 'text-xl',
  lg: 'text-2xl',
  xl: 'text-3xl',
}

// The chip row size for Song's progression display, keyed to the same setting.
const CHIP_SIZE_CLASSES: Record<ChordNameSize, string> = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-xl',
  xl: 'text-2xl',
}

// The prompt area (DESIGN.md §7.3): the chord NAME is primary, large and
// readable from a distance, with the next 2 upcoming combos inline at
// decreasing sizes. The voicing being drilled appears as a separate label
// (omitted for the `any` rule). Song mode swaps the preview for its
// left-to-right progression display.
export function PromptCard() {
  const prompt = usePractice((s) => s.prompt)
  const upcoming = usePractice((s) => s.upcoming)
  const song = usePractice((s) => s.song)
  const staffEnabled = useSettings((s) => s.settings.staffEnabled)
  const staffKeyEnabled = useSettings((s) => s.settings.staffKeyEnabled)
  const chordNameSize = useSettings((s) => s.settings.chordNameSize)

  if (!prompt) return null

  const showStaff = staffEnabled
  const keySignature = staffKeyEnabled ? prompt.chord.root : null
  const next2 = upcoming.slice(0, 2)

  return (
    <section className="flex flex-col items-center gap-4 text-center">
      {song !== null ? (
        <SongDisplay chordNameSize={chordNameSize} />
      ) : (
        <div className="flex flex-wrap items-baseline justify-center gap-x-10 gap-y-2">
          <h2
            className={cx(
              'font-extrabold tracking-tight',
              CHORD_NAME_SIZE_CLASSES[chordNameSize],
            )}
          >
            {prompt.displayName}
          </h2>
          {next2[0] && (
            <span
              className={cx(
                'font-extrabold text-ink-muted',
                PREVIEW_NEXT[chordNameSize],
              )}
            >
              {next2[0].label}
            </span>
          )}
          {next2[1] && (
            <span
              className={cx(
                'font-extrabold text-ink-faint',
                PREVIEW_AFTER[chordNameSize],
              )}
            >
              {next2[1].label}
            </span>
          )}
        </div>
      )}

      {song === null && prompt.voicing.id !== 'any' && (
        <p className="text-xl text-ink-muted">{prompt.voicing.name}</p>
      )}

      {/* Grand staff (§3.4). The fallback mirrors the card so the chunk/font
          load never jumps the layout. */}
      {showStaff && (
        <Suspense
          fallback={
            <div
              aria-hidden="true"
              className="h-[240px] w-[320px] rounded-lg bg-slate-100 shadow-inner"
            />
          }
        >
          <StaffView
            chord={prompt.chord}
            notes={prompt.example}
            keySignature={keySignature}
          />
        </Suspense>
      )}

      <FeedbackPill />
    </section>
  )
}

// The fixed-height feedback line (§7.3): a pill under the prompt. Always pairs
// color with an icon (§6.4); misses are visual-only (§9). The combo streak
// rides the ✔ flash once it reaches 10; a Practice answer past the §7.5 D/F
// speed boundary turns the flash amber with a `· slow` chip, and one at or
// under A's second earns `· fast`. The grade news of the rep — a combo that
// climbed a letter (§7.3), a chord that reached a passing grade (§5.1) — rides
// a second line beneath, so the pill itself stays the speed report.
function FeedbackPill() {
  const phase = usePractice((s) => s.phase)
  const reactionMs = usePractice((s) => s.reactionMs)
  const firstTryStreak = usePractice((s) => s.firstTryStreak)
  const hint = usePractice((s) => s.hint)
  const song = usePractice((s) => s.song)
  const mode = usePractice((s) => s.mode)
  const justLearned = usePractice((s) => s.justLearned)
  const gradeUp = usePractice((s) => s.gradeUp)

  const base =
    'inline-flex items-center gap-2 rounded-full px-[18px] py-1.5 font-extrabold'

  let content = null
  if (song !== null && song.countingIn) {
    content = (
      <span
        className={cx(base, 'bg-track text-base font-semibold text-ink-soft')}
      >
        <SongCountIn />
      </span>
    )
  } else if (phase === 'advancing' && reactionMs !== null) {
    // Slow is a Practice-mode judgment: Learn shows the answer from the start
    // and Song is clock-paced, so neither has a reaction time worth grading.
    // The bar is the grade's own D/F boundary (§7.5), so the chip fires on
    // exactly the reps that would grade the combo F on speed alone. Amber, not
    // F's red: this is one rep, a warning about pace, while the red letter is a
    // verdict on a whole window of them.
    const graded = mode === 'practice' && song === null
    const slow = graded && reactionMs > SLOW_TIME_MS
    // Fast is the same idea from the other end (§7.3): A's second, so the chip
    // fires on exactly the reps that would grade the combo A on speed alone.
    const fast = graded && reactionMs <= FAST_TIME_MS
    // At the cap the pill reports what was actually recorded (§6.2), so the
    // number the player sees is the number their stats moved by.
    const capped = Math.min(reactionMs, MAX_TIME_TO_CORRECT_MS)
    content = (
      <span
        className={cx(
          base,
          'text-lg',
          slow
            ? 'bg-warn-tint text-warn'
            : fast
              ? 'bg-info-tint text-info-light'
              : 'bg-primary-tint text-primary-light',
        )}
      >
        ✓ {(capped / 1000).toFixed(1)}s{capped < reactionMs && '+'}
        {slow && <span className="text-base font-semibold">· slow</span>}
        {fast && <span className="text-base font-semibold">· fast</span>}
        {firstTryStreak >= FIRST_TRY_STREAK_DISPLAY_MIN && (
          <span
            className={cx(
              'text-base',
              slow
                ? 'text-warn'
                : fast
                  ? 'text-info-light'
                  : 'text-primary-light',
            )}
          >
            🔥 {firstTryStreak} combo
          </span>
        )}
      </span>
    )
  } else if (hint !== null) {
    content = (
      <span className={cx(base, 'bg-danger-tint text-lg text-danger')}>
        ✕ {hintText(hint)}
      </span>
    )
  } else if (mode === 'learn' && song === null) {
    content = (
      <span
        className={cx(base, 'bg-track text-base font-semibold text-ink-soft')}
      >
        ◎ shape shown below — any matching voicing counts
      </span>
    )
  }

  // The grade news (§7.3) sits directly under the pill and lives exactly as
  // long as it does — it is about the rep the ✔ is flashing for, so it arrives
  // with it rather than in a toast of its own, minutes-old by the time it
  // appears. Both halves are the same news at two scales — this combo climbed a
  // letter, this chord is no longer failing — so they share one chip instead of
  // splitting the moment between the pill and the line under it.
  const advancing = phase === 'advancing'
  const showGradeUp = gradeUp !== null && advancing
  const showLearned = justLearned && advancing

  return (
    <div
      className="relative flex min-h-11 items-center justify-center"
      role="status"
    >
      {content}
      {/* Out of flow: the line keeps the feedback area a fixed height, so the
          keyboard below it doesn't hop every time a grade climbs. */}
      {(showGradeUp || showLearned) && (
        <span className="absolute top-full mt-1 inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-primary-tint px-3.5 py-0.5 text-sm font-semibold text-primary-light">
          {showGradeUp && (
            <>
              📈 <span className="font-extrabold">{gradeUp.label}</span> grade
              up: {gradeUp.from} →{' '}
              <span className="font-extrabold">{gradeUp.to}</span>
            </>
          )}
          {/* The rep that took a chord still in learning to a passing grade
              (§5.1) — the one moment "learned" is news. */}
          {showLearned && <span className="font-extrabold">★ learned</span>}
        </span>
      )}
    </div>
  )
}

// The §6.5 progression display: the current chord name large, the whole
// progression as chips (label over Roman numeral), the current chip pulsing
// on the beat and stamped ✓/✕ as each bar completes, plus the beat dots.
function SongDisplay({ chordNameSize }: { chordNameSize: ChordNameSize }) {
  const prompt = usePractice((s) => s.prompt)
  const song = usePractice((s) => s.song)
  const songChords = usePractice((s) => s.songChords)
  if (song === null) return null

  return (
    <div className="flex flex-col items-center gap-5">
      <h2
        className={cx(
          'font-extrabold tracking-tight',
          CHORD_NAME_SIZE_CLASSES[chordNameSize],
        )}
      >
        {prompt?.displayName ?? '—'}
      </h2>
      <div
        className={cx(
          'flex flex-wrap justify-center gap-3.5',
          CHIP_SIZE_CLASSES[chordNameSize],
        )}
      >
        {songChords.map((chip, i) => {
          const current = !song.countingIn && i === song.barIndex
          const result = song.results[i]
          const passed = result === true
          const missed = result === false
          return (
            <div
              key={`${i}-${chip.key}`}
              className={cx(
                'flex min-w-[104px] flex-col items-center gap-0.5 rounded-2xl border-2 px-3 py-3 leading-tight',
                current
                  ? 'border-primary ring-4 ring-primary/20'
                  : passed
                    ? 'border-primary-shadow bg-primary-tint'
                    : missed
                      ? 'border-[#6b2222] bg-[#331111]'
                      : 'border-muted-border bg-card',
              )}
            >
              <span
                key={current ? song.beat : -1}
                className={cx(
                  'font-extrabold',
                  current
                    ? 'animate-[beat-pulse_180ms_ease-out] text-ink'
                    : passed
                      ? 'text-primary-light'
                      : missed
                        ? 'text-danger'
                        : 'text-ink-muted',
                )}
              >
                {passed && '✓ '}
                {missed && '✕ '}
                {chip.label}
              </span>
              {chip.roman !== '' && (
                <span
                  className={cx(
                    'text-[0.6em] font-semibold',
                    current ? 'text-primary-light' : 'text-ink-faint',
                  )}
                >
                  {chip.roman}
                </span>
              )}
            </div>
          )
        })}
      </div>
      <BeatDots />
    </div>
  )
}

function BeatDots() {
  const song = usePractice((s) => s.song)
  if (song === null) return null
  return (
    <div className="flex items-center gap-3">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cx(
            'block rounded-full',
            i === song.beatInBar
              ? 'h-4 w-4 bg-primary shadow-[0_0_12px_rgba(88,204,2,0.5)]'
              : 'h-3.5 w-3.5 bg-ink-faint',
          )}
        />
      ))}
    </div>
  )
}

// The count-in line (§6.5): beat count, or the previous phrase's per-chord
// hit tally when one just completed.
function SongCountIn() {
  const song = usePractice((s) => s.song)
  const songSummary = usePractice((s) => s.songSummary)
  if (song === null || !song.countingIn) return null

  if (songSummary === null) {
    return <>Count-in… {song.beatInBar + 1}</>
  }
  return (
    <span className="flex flex-wrap items-center justify-center gap-x-3">
      <span className="text-ink-muted">Phrase:</span>
      {songSummary.map((entry, i) => (
        <span
          key={i}
          className={
            entry.hits === entry.loops
              ? 'text-primary-light'
              : entry.hits === 0
                ? 'text-danger'
                : 'text-ink-soft'
          }
        >
          {entry.label} {entry.hits}/{entry.loops}
        </span>
      ))}
    </span>
  )
}

function hintText(hint: Hint): string {
  switch (hint.kind) {
    case 'wrong-keys':
      return 'wrong keys marked — lift and retry'
    case 'constraint':
      return hint.text
    case 'reveal':
      return 'answer shown on the keyboard'
  }
}
