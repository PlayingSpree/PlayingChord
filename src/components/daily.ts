// A daily leg can be a fraction of a minute (¼ of a 5-minute cap, DESIGN.md
// §5.3): whole minutes read plain, anything else to one decimal.
export function formatMinutes(minutes: number): string {
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1)
}
