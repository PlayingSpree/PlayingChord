import { useSettings } from '../store/settingsStore'
import { SCALE_THUMB_HANDS, type ScaleThumbHand } from '../practice'
import { Chip } from './ui'

const LABELS: Record<ScaleThumbHand, string> = {
  off: 'Off',
  rh: 'RH',
  lh: 'LH',
}

// Fingering hand (§6.6): whose fingering the prompt shows and whose thumb the
// keyboard marks on a shown scale run. Offered in the
// session sheet and Settings alike, writing straight through to the one
// persisted setting.
export function ThumbHandChips() {
  const hand = useSettings((s) => s.settings.scaleThumbHand)
  const update = useSettings((s) => s.update)
  return (
    <div className="flex gap-1.5">
      {SCALE_THUMB_HANDS.map((id) => (
        <Chip
          key={id}
          selected={hand === id}
          onClick={() => update({ scaleThumbHand: id })}
          className="px-3 py-1 text-sm"
        >
          {LABELS[id]}
        </Chip>
      ))}
    </div>
  )
}
