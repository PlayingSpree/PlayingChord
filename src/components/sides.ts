import type { SessionMode, Side } from '../practice'
import { PRESET_MODE_ORDER } from './modes'

// The two sides of the app (DESIGN.md §7, §7.1), in Home's switch order.
export const SIDES: readonly Side[] = ['chords', 'scales']

export const SIDE_LABELS: Record<Side, string> = {
  chords: 'Chords',
  scales: 'Scales',
}

// On the Scales side the UI says *scale* wherever it says *chord* (§7).
const NOUNS: Record<Side, { one: string; many: string }> = {
  chords: { one: 'chord', many: 'chords' },
  scales: { one: 'scale', many: 'scales' },
}

// "chord" / "chords" — singular only for exactly one.
export function noun(side: Side, count = 2): string {
  return count === 1 ? NOUNS[side].one : NOUNS[side].many
}

// "3 chords", "1 scale".
export function counted(side: Side, count: number): string {
  return `${count} ${noun(side, count)}`
}

// "Chords", "Scale".
export function Noun(side: Side, count = 2): string {
  const word = noun(side, count)
  return word.charAt(0).toUpperCase() + word.slice(1)
}

// The side's preset modes in selector order: no Song on Scales — it drills
// chord transitions (§6.5).
export function presetModes(side: Side): readonly SessionMode[] {
  return side === 'scales'
    ? PRESET_MODE_ORDER.filter((mode) => mode !== 'song')
    : PRESET_MODE_ORDER
}

// The mode the preset controls show. The store's mode is the last session's,
// and after a daily one that names no preset mode — the controls fall back to
// free practice rather than showing nothing selected.
export function presetModeOf(mode: SessionMode): SessionMode {
  return mode === 'daily' ? 'free' : mode
}
