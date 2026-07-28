// The guided path's content (DESIGN.md §2): a fixed, ordered sequence of
// chapters, each a small batch of new material. Pure data plus the derivation
// that turns it into combos — the same (root, typeId, voicingId) triples
// generation and stats are already keyed by (§5). Progress over this data
// lives in path.ts; nothing here knows what the player has passed.
//
// Chapters are data for the same reason chord types and voicing rules are
// (§3.3): the *shape* of the track — key chapters interleaved with skill
// chapters, each skill applied to roots already learned — is the decision,
// and the exact roster tunes freely.

import {
  formatSpelling,
  getChordType,
  isPatternRule,
  MAJOR_SCALE_SEMITONES,
  pitchClass,
  spellChordTone,
  spellMajorKeyTonic,
  spellMajorScaleDegree,
  BUILT_IN_VOICING_LIBRARY,
  type ChordTypeId,
  type NoteSpelling,
  type PitchClass,
  type VoicingLibrary,
} from '../theory'
import { comboKey, type Combo } from './combos'
import { DIATONIC_QUALITIES } from './presets'
import { patternShapeLabel } from './library'
import { songChordLabel } from './song'

// A batch is at most this wide — the same width a fresh v9 preset opened with
// (§2.3): enough to alternate between, small enough to hold in the head.
export const MAX_BATCH_SIZE = 3

// Every major and minor triad, which the ten key chapters cover exactly
// (§2.1). Skill chapters add depth on roots already counted here, so this is
// the denominator of the path's "N of 24 chords" and it never drifts.
export const PATH_TRIAD_TOTAL = 24

// The chord types that count toward PATH_TRIAD_TOTAL.
export const TRIAD_TYPE_IDS: readonly ChordTypeId[] = ['maj', 'min']

// How the path declares one drillable thing: a scale degree of a key, not a
// raw pitch class. That is what makes the spelling right without a per-chapter
// table — A♭'s IV is D♭ and never C♯, E's vii° is D♯ and never E♭ (§3.5) —
// and it keeps the data readable as music rather than as arithmetic.
interface ComboSpec {
  key: PitchClass
  degree: number // 0-based major-scale degree within `key`
  typeId: ChordTypeId
  voicingId: string
}

export interface PathCombo {
  combo: Combo
  key: PitchClass
  degree: number
  spelling: NoteSpelling // the root, spelled from `key`
  label: string // "C" · "Am" · "C/E" · "G7" · "Csus4" · "D♯°" · "C · 1 + 1-3-5"
}

export type ChapterKind = 'key' | 'skill'

export interface ChapterDefinition {
  // Stable across track edits — it keys the persisted record (§5.1), so
  // renaming one silently discards that chapter's progress.
  id: string
  kind: ChapterKind
  title: string
  blurb: string // the path map's one-line contents (§4.2)
  key: PitchClass | null // key chapters only
  // The chapter song's degrees (§3.3), I–IV–V–I. Key chapters only: Song
  // voices everything with `any` (§6.5), so a skill chapter has nothing to
  // check and gets no song in v10.
  songDegrees: readonly number[] | null
  combos: readonly PathCombo[] // declared order *is* batch order
  batches: readonly (readonly PathCombo[])[]
}

// The slash name a bass constraint produces: first inversion of C major *is*
// C/E, so the notation is the label rather than a separate concept (§2.2).
// Derived from the rule instead of an id list, so a user rule with a bass on
// the third would name itself the same way.
function voicingSuffix(
  spec: ComboSpec,
  spelling: NoteSpelling,
  voicings: VoicingLibrary,
): string {
  const rule = voicings.get(spec.voicingId)
  if (rule === undefined) return ''
  if (isPatternRule(rule)) {
    return ` · ${patternShapeLabel(rule.leftHand, rule.rightHand)}`
  }
  // Root position *is* the chord name; `any` says nothing about the bass.
  if (rule.bass.kind !== 'chordTone' || rule.bass.degree === 0) return ''
  const interval = getChordType(spec.typeId).intervals[rule.bass.degree]
  if (interval === undefined) return ''
  return `/${formatSpelling(spellChordTone(spelling, interval))}`
}

function pathCombo(
  spec: ComboSpec,
  voicings: VoicingLibrary = BUILT_IN_VOICING_LIBRARY,
): PathCombo {
  const spelling = spellMajorScaleDegree(spec.key, spec.degree)
  return {
    combo: {
      root: spelling.pc,
      typeId: spec.typeId,
      voicingId: spec.voicingId,
    },
    key: spec.key,
    degree: spec.degree,
    spelling,
    label:
      songChordLabel(spelling, spec.typeId) +
      voicingSuffix(spec, spelling, voicings),
  }
}

// Chunks a chapter's combos into batches. `sizes` overrides the default only
// where even 3s would end in a batch of one: a lone combo is massed repetition
// on the last thing left, which §3.1 rejects — and for sus, where one root's
// sus2/sus4 pair is the contrast worth drilling together.
function batchesOf(
  combos: readonly PathCombo[],
  sizes?: readonly number[],
): readonly (readonly PathCombo[])[] {
  const widths =
    sizes ??
    Array.from(
      { length: Math.ceil(combos.length / MAX_BATCH_SIZE) },
      () => MAX_BATCH_SIZE,
    )
  const batches: PathCombo[][] = []
  let at = 0
  for (const width of widths) {
    if (at >= combos.length) break
    batches.push(combos.slice(at, at + width))
    at += width
  }
  // A declared width list that came up short must not silently drop material.
  if (at < combos.length) batches.push(combos.slice(at))
  return batches
}

// A key chapter: the diatonic triads of one major key the player doesn't
// already have (§2.1). After C every key contributes exactly 2 — the rest of
// its diatonic set arrived with an earlier key — and its song reuses old
// chords in the new context, so review is built into the structure.
function keyChapter(
  key: PitchClass,
  newDegrees: readonly number[],
  voicingId: string,
  batchSizes?: readonly number[],
): ChapterDefinition {
  const combos = newDegrees.map((degree) =>
    pathCombo({
      key,
      degree,
      typeId: DIATONIC_QUALITIES[degree] ?? 'maj',
      voicingId,
    }),
  )
  const tonic = formatSpelling(spellMajorKeyTonic(key))
  return {
    id: `key-${tonic.toLowerCase().replace('♭', 'b').replace('♯', 's')}`,
    kind: 'key',
    title: `Key of ${tonic}`,
    blurb: combos.map((c) => c.label).join(' · '),
    key,
    songDegrees: SONG_DEGREES,
    combos,
    batches: batchesOf(combos, batchSizes),
  }
}

// I–IV–V–I in the chapter's key (§3.3): one new chord and two the player
// already owns, returning to the tonic so four bars sound like music.
export const SONG_DEGREES: readonly number[] = [0, 3, 4, 0]

// A skill chapter: a voicing or chord-quality skill over roots already
// learned (§2.2). Never a new-chord unlock — extensions are depth on known
// material, not breadth, which is what keeps the 24 triads the whole breadth
// of the path.
function skillChapter(
  id: string,
  title: string,
  blurb: string,
  specs: readonly ComboSpec[],
  batchSizes?: readonly number[],
): ChapterDefinition {
  const combos = specs.map((spec) => pathCombo(spec))
  return {
    id,
    kind: 'skill',
    title,
    blurb,
    key: null,
    songDegrees: null,
    combos,
    batches: batchesOf(combos, batchSizes),
  }
}

// Shorthands for skill-chapter specs, so the track below reads as music.
const at = (
  key: PitchClass,
  degree: number,
  typeId: ChordTypeId,
  voicingId = 'any',
): ComboSpec => ({ key, degree, typeId, voicingId })

// Tonic of a key the player already has, for skills that apply to whole
// chords rather than to a scale degree.
const tonic = (key: PitchClass, typeId: ChordTypeId, voicingId: string) =>
  at(key, 0, typeId, voicingId)

const C = 0
const Db = 1
const D = 2
const Eb = 3
const E = 4
const F = 5
const G = 7
const Ab = 8
const A = 9
const Bb = 10

// ─── The track (§2.2) ──────────────────────────────────────────────────────
// Key chapters follow the circle of fifths from C, alternating sharp and flat
// sides — the classic pedagogy order and, roughly, key commonness. Sharp-side
// keys contribute their new V and iii; flat-side keys their new IV and ii.
// That regularity is why every key after C contributes exactly two chords.
export const CHAPTERS: readonly ChapterDefinition[] = [
  // Root position first (§5.3): the canonical shape, and what the example
  // voicing teaches anyway. C F G before Am Dm Em so the very first batch is
  // I–IV–V — playable music after one session (§2.3).
  keyChapter(C, [0, 3, 4, 5, 1, 2], 'root-position'),

  skillChapter(
    'inversions-c',
    'Inversions in C',
    'C/E · F/A · G/B · C/G · F/C · G/D',
    [
      at(C, 0, 'maj', 'first-inversion'),
      at(C, 3, 'maj', 'first-inversion'),
      at(C, 4, 'maj', 'first-inversion'),
      at(C, 0, 'maj', 'second-inversion'),
      at(C, 3, 'maj', 'second-inversion'),
      at(C, 4, 'maj', 'second-inversion'),
    ],
  ),

  // From here on `any` (§5.3): the player has the inversion concept, so the
  // name is the whole prompt.
  keyChapter(G, [4, 2], 'any'),
  keyChapter(F, [3, 1], 'any'),

  skillChapter(
    'dominant-7',
    'Dominant 7',
    'G7 · D7 · C7 — the V7 of the keys you know',
    [at(C, 4, 'dom7'), at(G, 4, 'dom7'), at(F, 4, 'dom7')],
  ),

  keyChapter(D, [4, 2], 'any'),
  keyChapter(A, [4, 2], 'any'),

  skillChapter(
    'lh-root-bass',
    'LH root bass',
    'Left hand 1 · right hand 1-3-5',
    [
      tonic(C, 'maj', 'lh-root'),
      at(C, 3, 'maj', 'lh-root'),
      at(C, 4, 'maj', 'lh-root'),
      tonic(D, 'maj', 'lh-root'),
      tonic(A, 'maj', 'lh-root'),
      tonic(Bb, 'maj', 'lh-root'),
      tonic(E, 'maj', 'lh-root'),
    ],
    [3, 2, 2],
  ),

  keyChapter(E, [4, 2], 'any'),
  keyChapter(Bb, [3, 1], 'any'),

  skillChapter(
    'sus',
    'sus2 / sus4',
    'Suspensions on C · F · G · D · A',
    [
      at(C, 0, 'sus2'),
      at(C, 0, 'sus4'),
      at(C, 3, 'sus2'),
      at(C, 3, 'sus4'),
      at(C, 4, 'sus2'),
      at(C, 4, 'sus4'),
      at(D, 0, 'sus2'),
      at(D, 0, 'sus4'),
      at(A, 0, 'sus2'),
      at(A, 0, 'sus4'),
    ],
    // One root's pair per batch: sus2 against sus4 on the same chord is the
    // contrast the chapter exists to teach.
    [2, 2, 2, 2, 2],
  ),

  keyChapter(Eb, [3, 1], 'any'),
  keyChapter(Ab, [3, 1], 'any'),

  skillChapter(
    'diminished',
    'Diminished',
    'The vii° of every key you know — closing the diatonic set',
    [
      at(C, 6, 'dim'),
      at(G, 6, 'dim'),
      at(F, 6, 'dim'),
      at(D, 6, 'dim'),
      at(A, 6, 'dim'),
      at(E, 6, 'dim'),
      at(Bb, 6, 'dim'),
      at(Eb, 6, 'dim'),
      at(Ab, 6, 'dim'),
    ],
  ),

  keyChapter(Db, [3, 1], 'any'),

  skillChapter(
    'sevenths',
    'maj7 / min7',
    'Imaj7 · ii-7 · vi-7 of the common keys',
    [
      at(C, 0, 'maj7'),
      at(G, 0, 'maj7'),
      at(F, 0, 'maj7'),
      at(C, 1, 'min7'),
      at(G, 1, 'min7'),
      at(G, 5, 'min7'),
      at(F, 1, 'min7'),
    ],
    [3, 2, 2],
  ),
]

export function chapterById(id: string): ChapterDefinition | undefined {
  return CHAPTERS.find((chapter) => chapter.id === id)
}

// comboKey → the path combo that owns it. Every lookup from a recorded rep
// goes through here: it is what lets one stats key say which chapter and which
// index a pass belongs to (§2.3), and what supplies the key-correct spelling
// wherever the combo is displayed (§3.5).
export const PATH_COMBO_INDEX: ReadonlyMap<string, PathCombo> = new Map(
  CHAPTERS.flatMap((chapter) =>
    chapter.combos.map((pc) => [comboKey(pc.combo), pc] as const),
  ),
)

// Which batch a combo index falls in, for the Stage's chip row and the
// path map's current-chapter line.
export function batchOfIndex(
  chapter: ChapterDefinition,
  comboIndex: number,
): number {
  let at = 0
  for (let batch = 0; batch < chapter.batches.length; batch++) {
    at += chapter.batches[batch]?.length ?? 0
    if (comboIndex < at) return batch
  }
  return Math.max(0, chapter.batches.length - 1)
}

// Does this combo count toward PATH_TRIAD_TOTAL? Only plain major and minor
// triads do; a chapter's inversions and patterns reuse a pair already counted,
// and sus/dim/7th types sit outside the 24 entirely.
export function isPathTriad(combo: Combo): boolean {
  return TRIAD_TYPE_IDS.includes(combo.typeId)
}

// The (root, quality) identity the triad counter dedupes on — the same shape
// the retired per-chord progress used, kept here because the counter is the
// only thing left that thinks in chords rather than combos.
export function triadKey(combo: Combo): string {
  return `${combo.root}:${combo.typeId}`
}

// Guards the pitch-class arithmetic above: MAJOR_SCALE_SEMITONES is the one
// table both the spelling and the root derivation read, so a chapter degree
// out of range would produce a chord nobody declared.
export function isValidDegree(degree: number): boolean {
  return (
    Number.isInteger(degree) &&
    degree >= 0 &&
    degree < MAJOR_SCALE_SEMITONES.length
  )
}

// Exported for the tests' arithmetic cross-check: the root a spec resolves to,
// computed from the key rather than read off the spelling.
export function degreeRoot(key: PitchClass, degree: number): PitchClass {
  return pitchClass(key + (MAJOR_SCALE_SEMITONES[degree] ?? 0))
}
