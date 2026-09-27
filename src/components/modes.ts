import type { SessionMode } from '../practice'

// The four session modes as the UI names them (DESIGN.md §7): Home's
// selector, the session sheet's segmented row and the Stage's session label
// all read from here, so a mode is called the same thing wherever it appears.
export const MODE_LABELS: Record<SessionMode, string> = {
  learn: '🎓 Learn',
  daily: '☀ Daily',
  free: '▶ Free',
  song: '♪ Song',
}

// The modes that run on the selected preset, in selector order — Home's
// Continue card and the session sheet. Daily isn't one: it draws on every
// preset (§5.3), so it has its own card on Home (§7.1) rather than a slot
// beside the preset it ignores.
export const PRESET_MODE_ORDER: readonly SessionMode[] = [
  'learn',
  'free',
  'song',
]

export const START_LABEL: Record<SessionMode, string> = {
  learn: 'Start learning ▶',
  daily: 'Start daily practice ▶',
  free: 'Start practicing ▶',
  song: 'Start song ▶',
}
