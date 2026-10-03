import { useSettings } from '../store/settingsStore'
import { practiceStore } from '../store/practiceStore'
import { SCALE_HAND_PICKS, type ScaleHandPick } from '../practice'
import { Chip, Toggle } from './ui'

const LABELS: Record<ScaleHandPick, string> = {
  rh: 'RH',
  lh: 'LH',
  both: 'Both',
}

// Scale hand (§3.6, §6.6): which hand runs are dealt for — each hand's runs
// are combos of their own, so this moves the pool, and the store re-expands
// it. Offered in the session sheet and Settings alike, writing straight
// through to the one persisted setting.
export function ScaleHandChips() {
  const hand = useSettings((s) => s.settings.scaleHand)
  const update = useSettings((s) => s.update)
  return (
    <div className="flex gap-1.5">
      {SCALE_HAND_PICKS.map((id) => (
        <Chip
          key={id}
          selected={hand === id}
          onClick={() => {
            if (id === hand) return
            update({ scaleHand: id })
            practiceStore.getState().refreshScaleHand()
          }}
          className="px-3 py-1 text-sm"
        >
          {LABELS[id]}
        </Chip>
      ))}
    </div>
  )
}

// Show fingering (§6.6, §7.3): the prompt's fingering line — each finger over
// the note it plays — and the keyboard's thumb marks. Off keeps a run pure
// recall.
export function FingeringToggle() {
  const shown = useSettings((s) => s.settings.scaleFingeringShown)
  const update = useSettings((s) => s.update)
  return (
    <Toggle
      checked={shown}
      onChange={(v) => update({ scaleFingeringShown: v })}
      aria-label="Show fingering"
    />
  )
}
