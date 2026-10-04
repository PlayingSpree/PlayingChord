// Full backup/restore of the persisted state (DESIGN.md §8): everything the
// app keeps, as one JSON file, for moving progress between browsers or
// machines. Unlike the library import (importExport.ts) a restore replaces
// rather than merges — two stats histories have no meaningful union. Pure TS
// — file download/upload and the reload after a restore live in the UI.

import { migrateState } from './migrate'
import { SCHEMA_VERSION, type PersistedState } from './schema'

export const BACKUP_KIND = 'playingchord-backup'

// The exported document. The state carries its own schema version, so a
// restore runs it through the same migration chain as a localStorage load.
export interface BackupFile {
  kind: typeof BACKUP_KIND
  exportedAt: string // ISO timestamp, shown before a restore
  state: PersistedState
}

export function exportBackupJson(state: PersistedState, now: Date): string {
  const file: BackupFile = {
    kind: BACKUP_KIND,
    exportedAt: now.toISOString(),
    state,
  }
  return JSON.stringify(file, null, 2)
}

export type BackupParseResult =
  | { ok: true; state: PersistedState; exportedAt: string | null }
  | { ok: false; error: string }

export function parseBackup(json: string): BackupParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return { ok: false, error: 'Not valid JSON.' }
  }
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as Record<string, unknown>).kind !== BACKUP_KIND
  ) {
    return { ok: false, error: 'Not a PlayingChord backup file.' }
  }
  const file = raw as Record<string, unknown>
  const state = file.state
  const version =
    typeof state === 'object' && state !== null && !Array.isArray(state)
      ? (state as Record<string, unknown>).version
      : undefined
  if (
    typeof version !== 'number' ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return { ok: false, error: 'The file has no valid schema version.' }
  }
  // Checked here because migrateState resets an unknown version to defaults
  // — right for a stale localStorage blob, wrong for a file the user chose.
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      error: `The file was exported by a newer app version (schema v${version}; this app reads up to v${SCHEMA_VERSION}).`,
    }
  }
  return {
    ok: true,
    state: migrateState(state),
    exportedAt: typeof file.exportedAt === 'string' ? file.exportedAt : null,
  }
}

// What a restore writes: the backup wholesale, except the last MIDI device —
// a device id from another machine means nothing here, so this one's stays.
export function restoredState(
  backup: PersistedState,
  current: PersistedState,
): PersistedState {
  return { ...backup, lastMidiDevice: current.lastMidiDevice }
}
