// JSON import/export of the custom library (DESIGN.md §4): custom presets
// plus the custom voicing rules they depend on, for backup/transfer across
// browsers or machines. Pure TS — file download/upload lives in the UI.

import type { Preset } from '../practice'
import type { VoicingRule } from '../theory'
import {
  sanitizeCustomPresets,
  sanitizeCustomVoicingRules,
  SCHEMA_VERSION,
} from './schema'

export const LIBRARY_EXPORT_KIND = 'playingchord-library'

// The exported document. `version` is the schema version the bundle was
// written under; imports accept same-or-older and refuse newer.
export interface LibraryExport {
  kind: typeof LIBRARY_EXPORT_KIND
  version: number
  voicingRules: readonly VoicingRule[]
  presets: readonly Preset[]
}

// Exports the whole custom library — every custom preset and every custom
// rule (a superset of "the rules the presets depend on", so dependencies are
// always included and standalone rules survive the transfer too).
export function exportLibraryJson(
  voicingRules: readonly VoicingRule[],
  presets: readonly Preset[],
): string {
  const bundle: LibraryExport = {
    kind: LIBRARY_EXPORT_KIND,
    version: SCHEMA_VERSION,
    voicingRules,
    presets,
  }
  return JSON.stringify(bundle, null, 2)
}

// What an import would change, plus what it reports (§4: conflicts are id
// collisions). Colliding items are never applied — the local version wins —
// so importing is always safe to retry.
export interface ImportPlan {
  voicingRules: VoicingRule[] // new rules to append
  presets: Preset[] // new presets to append
  alreadyPresent: string[] // names of incoming items identical to local ones
  conflicts: string[] // names of id collisions with differing content
  invalid: number // junk entries dropped by the sanitizers
}

export type ImportResult =
  { ok: true; plan: ImportPlan } | { ok: false; error: string }

// Both sides of a comparison have passed through the same sanitizers, which
// construct objects in a fixed field order — so JSON equality is structural
// equality here.
function sameContent(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function planImport(
  json: string,
  existingRules: readonly VoicingRule[],
  existingPresets: readonly Preset[],
): ImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, error: 'Not valid JSON.' }
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as Record<string, unknown>).kind !== LIBRARY_EXPORT_KIND
  ) {
    return { ok: false, error: 'Not a PlayingChord library file.' }
  }
  const bundle = raw as Record<string, unknown>
  const version = bundle.version
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return { ok: false, error: 'The file has no valid schema version.' }
  }
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `The file was exported by a newer app version (schema v${version}; this app reads up to v${SCHEMA_VERSION}).`,
    }
  }

  const rawRules = Array.isArray(bundle.voicingRules) ? bundle.voicingRules : []
  const rawPresets = Array.isArray(bundle.presets) ? bundle.presets : []
  const incomingRules = sanitizeCustomVoicingRules(rawRules)
  // Incoming presets may reference incoming rules, existing custom rules, or
  // built-ins — sanitize against the union. A reference to a *conflicting*
  // incoming rule stays valid: the id exists locally by definition.
  const incomingPresets = sanitizeCustomPresets(rawPresets, [
    ...existingRules,
    ...incomingRules,
  ])

  const plan: ImportPlan = {
    voicingRules: [],
    presets: [],
    alreadyPresent: [],
    conflicts: [],
    invalid:
      rawRules.length -
      incomingRules.length +
      (rawPresets.length - incomingPresets.length),
  }

  const localRules = new Map(existingRules.map((r) => [r.id, r]))
  for (const rule of incomingRules) {
    const local = localRules.get(rule.id)
    if (local === undefined) plan.voicingRules.push(rule)
    else if (sameContent(local, rule)) plan.alreadyPresent.push(rule.name)
    else plan.conflicts.push(rule.name)
  }
  const localPresets = new Map(existingPresets.map((p) => [p.id, p]))
  for (const preset of incomingPresets) {
    const local = localPresets.get(preset.id)
    if (local === undefined) plan.presets.push(preset)
    else if (sameContent(local, preset)) plan.alreadyPresent.push(preset.name)
    else plan.conflicts.push(preset.name)
  }
  return { ok: true, plan }
}
