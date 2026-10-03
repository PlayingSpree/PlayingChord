import {
  BUILT_IN_VOICING_LIBRARY,
  CHORD_TYPES,
  getScaleShape,
  isScaleShapeId,
  isScaleTypeId,
  type ChordTypeId,
  type Hand,
  type PitchClass,
  type ScaleShapeId,
  type ScaleTypeId,
  type VoicingLibrary,
} from '../theory'

// A combo is the unit of generation and stats: one drillable thing
// (DESIGN.md §5) — a (root, chord type, voicing rule) triple, or its scale
// counterpart (root, scale type, shape) (§3.6).
//
// `kind` is optional on the chord side so every chord combo — and every key
// and literal written before scales existed — stays as it was; absence means
// 'chord'.
export interface ChordCombo {
  kind?: 'chord'
  root: PitchClass
  typeId: ChordTypeId
  voicingId: string
}

// `hand` is the hand the player declared for a run (§3.6) — declared, never
// checked, since MIDI can't see hands. A `block` shape is every note at once,
// which no one hand can hold, so it has none.
export interface ScaleCombo {
  kind: 'scale'
  root: PitchClass
  scaleTypeId: ScaleTypeId
  shapeId: ScaleShapeId
  hand: Hand | null
}

export type Combo = ChordCombo | ScaleCombo

export function isScaleCombo(combo: Combo): combo is ScaleCombo {
  return combo.kind === 'scale'
}

// The app's two halves (§7.1): Home switches between them, and the daily
// counters, active preset and best combo streak are kept per side (§8).
export type Side = 'chords' | 'scales'

export function comboSide(combo: Combo): Side {
  return isScaleCombo(combo) ? 'scales' : 'chords'
}

// A stored key's side, read off its prefix — no parse, so a stale scale key
// still counts where it was played.
export function comboKeySide(key: string): Side {
  return key.startsWith('s:') ? 'scales' : 'chords'
}

// The hand a shape is played with, given the one declared: a run takes it,
// `block` takes none (§3.6).
export function shapeHand(shapeId: ScaleShapeId, hand: Hand): Hand | null {
  return getScaleShape(shapeId).kind === 'run' ? hand : null
}

// Scale keys carry a prefix so every chord key — and the stats persisted
// under it — is byte-identical to what it was before scales (§8). A
// right-hand run keeps the key every run had before hands were declared, so
// that history reads as the right hand's — the default hand it was played
// under; only a left-hand run adds a suffix.
export function comboKey(combo: Combo): string {
  if (isScaleCombo(combo)) {
    const base = `s:${combo.root}:${combo.scaleTypeId}:${combo.shapeId}`
    return combo.hand === 'lh' ? `${base}:lh` : base
  }
  return `${combo.root}:${combo.typeId}:${combo.voicingId}`
}

const KNOWN_TYPE_IDS = new Set<string>(CHORD_TYPES.map((t) => t.id))

function parseRoot(part: string | undefined): PitchClass | null {
  if (!part) return null
  const root = Number(part)
  if (!Number.isInteger(root) || root < 0 || root > 11) return null
  return root
}

// Inverse of comboKey, for walking persisted stat records back into combos
// (the §7 History view is keyed by stored keys, not a live preset). Returns
// null for keys that don't name a known type/voicing/shape — stale keys from
// a removed chord or scale type, a deleted custom rule, or a hand-edited
// store must not crash a display path.
export function parseComboKey(
  key: string,
  voicings: VoicingLibrary = BUILT_IN_VOICING_LIBRARY,
): Combo | null {
  if (key.startsWith('s:')) {
    const [, rootPart, scaleTypeId, shapeId, handPart, ...rest] = key.split(':')
    const root = parseRoot(rootPart)
    if (
      root === null ||
      rest.length > 0 ||
      scaleTypeId === undefined ||
      shapeId === undefined ||
      !isScaleTypeId(scaleTypeId) ||
      !isScaleShapeId(shapeId)
    ) {
      return null
    }
    // Only a run takes a hand, and only the left hand is spelled out.
    const hand = shapeHand(shapeId, handPart === 'lh' ? 'lh' : 'rh')
    if (handPart !== undefined && (handPart !== 'lh' || hand === null)) {
      return null
    }
    return { kind: 'scale', root, scaleTypeId, shapeId, hand }
  }
  const [rootPart, typeId, ...voicingParts] = key.split(':')
  const voicingId = voicingParts.join(':')
  const root = parseRoot(rootPart)
  if (root === null || !typeId || voicingId === '') return null
  if (!KNOWN_TYPE_IDS.has(typeId) || voicings.get(voicingId) === undefined) {
    return null
  }
  return { root, typeId: typeId as ChordTypeId, voicingId }
}
