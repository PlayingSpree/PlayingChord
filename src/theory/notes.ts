// Pitch fundamentals (DESIGN.md §3.1): everything is MIDI note numbers
// (60 = middle C); a pitch class is 0–11 with C = 0.

export type PitchClass = number

export const MIDDLE_C = 60

export const ALL_PITCH_CLASSES: readonly PitchClass[] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
]

export function pitchClass(midiNote: number): PitchClass {
  return ((midiNote % 12) + 12) % 12
}
