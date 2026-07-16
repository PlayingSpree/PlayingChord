// Daily goal & streak logic (DESIGN.md §7): pure functions over the §8
// daily records. Streaks are always *derived* from the records against the
// current goal — nothing is stored, so a changed goal or repaired history
// can never disagree with a cached counter.

import { localDateKey, type DailyRecord } from './schema'

// 'YYYY-MM-DD' → local Date at noon. Noon keeps day arithmetic safe on DST
// days (23/25-hour days shift midnight, never noon).
export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1, 12)
}

export function previousDateKey(key: string): string {
  const date = parseDateKey(key)
  date.setDate(date.getDate() - 1)
  return localDateKey(date)
}

// The last `count` day keys ending at `todayKey`, oldest first — the x-axis
// of the History trends and calendar.
export function lastDateKeys(todayKey: string, count: number): string[] {
  const keys: string[] = []
  const date = parseDateKey(todayKey)
  for (let i = 0; i < count; i++) {
    keys.unshift(localDateKey(date))
    date.setDate(date.getDate() - 1)
  }
  return keys
}

export function meetsGoal(
  record: DailyRecord | undefined,
  goalMinutes: number,
): boolean {
  return record !== undefined && record.activeMinutes >= goalMinutes
}

// Streak = consecutive local days meeting the goal, ending today (§7). A
// today that hasn't met the goal *yet* doesn't break the chain — the streak
// counts from yesterday until the day is actually over.
export function computeStreak(
  records: Readonly<Record<string, DailyRecord>>,
  goalMinutes: number,
  todayKey: string,
): number {
  let day = meetsGoal(records[todayKey], goalMinutes)
    ? todayKey
    : previousDateKey(todayKey)
  let streak = 0
  while (meetsGoal(records[day], goalMinutes)) {
    streak += 1
    day = previousDateKey(day)
  }
  return streak
}

// Longest goal-met run anywhere in the records (§7 History).
export function computeBestStreak(
  records: Readonly<Record<string, DailyRecord>>,
  goalMinutes: number,
): number {
  const metDays = new Set(
    Object.values(records)
      .filter((record) => meetsGoal(record, goalMinutes))
      .map((record) => record.date),
  )
  let best = 0
  for (const day of metDays) {
    if (metDays.has(previousDateKey(day))) continue // not a run start
    let length = 1
    let next = day
    for (;;) {
      const date = parseDateKey(next)
      date.setDate(date.getDate() + 1)
      next = localDateKey(date)
      if (!metDays.has(next)) break
      length += 1
    }
    best = Math.max(best, length)
  }
  return best
}
