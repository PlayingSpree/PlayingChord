import type { ComboGrade } from '../practice'

// One tier assignment behind every grade surface (§7.5) — Home's In play chips,
// the chord stats table and the Report's badge — so a letter can't mean green in
// one place and red in another. S sits apart in blue because it is the top of
// the scale and deliberately rare (flawless, inside a second); A/B green, C/D
// neutral, F red keep the three-tier heat map the prototype reads by.
//
// Red is F alone: D is a passing grade (§5.1), and a letter that unlocks the
// next chords can't be the same color as the one that doesn't.
type GradeTier = 'top' | 'good' | 'neutral' | 'bad'

const TIER: Record<ComboGrade, GradeTier> = {
  S: 'top',
  A: 'good',
  B: 'good',
  C: 'neutral',
  D: 'neutral',
  F: 'bad',
}

// Letter on its own (a chip already carrying its own background).
const TEXT: Record<GradeTier, string> = {
  top: 'text-info-light',
  good: 'text-primary-light',
  neutral: 'text-ink-soft',
  bad: 'text-danger',
}

// Filled cell — the stats table's heat map.
const TINT: Record<GradeTier, string> = {
  top: 'bg-info-tint text-info-light',
  good: 'bg-primary-tint text-primary-light',
  neutral: 'bg-track text-ink-soft',
  bad: 'bg-danger-tint text-danger',
}

// Bordered disc — the Report's session-grade badge.
const RING: Record<GradeTier, string> = {
  top: 'border-info bg-info-tint text-info-light',
  good: 'border-primary bg-primary-tint text-primary-light',
  neutral: 'border-card-border bg-track text-ink-soft',
  bad: 'border-danger bg-danger-tint text-danger',
}

export const gradeText = (grade: ComboGrade): string => TEXT[TIER[grade]]
export const gradeTint = (grade: ComboGrade): string => TINT[TIER[grade]]
export const gradeRing = (grade: ComboGrade): string => RING[TIER[grade]]
