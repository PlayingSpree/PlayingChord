// localStorage persistence (DESIGN.md §8): versioned schema + migration,
// persisted combo/daily stat records, and the thin localStorage adapter.
// Import/export and custom presets/voicing rules join in Phase 9.
export * from './schema'
export * from './migrate'
export * from './appStorage'
export * from './persistedStats'
export * from './goals'
export * from './localStorageAdapter'
