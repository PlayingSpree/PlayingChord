import { useEffect } from 'react'
import { usePractice } from '../store/practiceStore'
import { useSettings } from '../store/settingsStore'

// Top-bar goal/streak chip (§7): current streak plus today's progress
// toward the daily active-minutes goal. Progress state is pushed by the
// practice store whenever buffered active time flushes; a changed goal
// setting re-derives it here.
export function GoalChip() {
  const goal = usePractice((s) => s.goal)
  const refreshGoal = usePractice((s) => s.refreshGoal)
  const goalMinutes = useSettings((s) => s.settings.dailyGoalMinutes)

  useEffect(() => {
    refreshGoal()
  }, [goalMinutes, refreshGoal])

  const met = goal.todayMinutes >= goalMinutes
  const todayWhole = Math.floor(goal.todayMinutes)

  return (
    <div
      className="flex items-center gap-2 rounded-md border border-slate-700 px-2.5 py-1 text-sm"
      title={`Streak: ${goal.streak} day${goal.streak === 1 ? '' : 's'} — today ${todayWhole} of ${goalMinutes} active minutes`}
    >
      <span className="text-slate-300">
        🔥 <span className="font-semibold text-slate-100">{goal.streak}</span>
      </span>
      <span className={met ? 'font-medium text-emerald-400' : 'text-slate-400'}>
        {met && '✓ '}
        {todayWhole}/{goalMinutes} min
      </span>
    </div>
  )
}
