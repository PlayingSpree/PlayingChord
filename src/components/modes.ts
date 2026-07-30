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

// Selector order: learn, then the two practice modes (§5.3 daily before the
// configured drill it is meant to save you from configuring), then Song.
export const MODE_ORDER: readonly SessionMode[] = [
  'learn',
  'daily',
  'free',
  'song',
]

export const START_LABEL: Record<SessionMode, string> = {
  learn: 'Start learning ▶',
  daily: 'Start daily practice ▶',
  free: 'Start practicing ▶',
  song: 'Start song ▶',
}
