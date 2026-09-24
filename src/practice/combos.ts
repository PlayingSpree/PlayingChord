import {
  BUILT_IN_VOICING_LIBRARY,
  CHORD_TYPES,
  isScaleShapeId,
  isScaleTypeId,
  type ChordTypeId,
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

export interface ScaleCombo {
  kind: 'scale'
  root: PitchClass
  scaleTypeId: ScaleTypeId
  shapeId: ScaleShapeId
}

export type Combo = ChordCombo | ScaleCombo

export function isScaleCombo(combo: Combo): combo is ScaleCombo {
  return combo.kind === 'scale'
}

// Scale keys carry a prefix so every chord key — and the stats persisted
// under it — is byte-identical to what it was before scales (§8).
export function comboKey(combo: Combo): string {
  if (isScaleCombo(combo)) {
    return `s:${combo.root}:${combo.scaleTypeId}:${combo.shapeId}`
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
    const [, rootPart, scaleTypeId, shapeId, ...rest] = key.split(':')
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
    return { kind: 'scale', root, scaleTypeId, shapeId }
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
