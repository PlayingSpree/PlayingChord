import { useMidi } from '../store/midiStore'

// The top-bar MIDI device readout (§6.1/§7.1): the device name when there's
// nothing to choose between, a picker when there is. Styled like the other
// v9 raised controls (§7).
export function DevicePicker() {
  const devices = useMidi((s) => s.devices)
  const activeDeviceId = useMidi((s) => s.activeDeviceId)
  const selectDevice = useMidi((s) => s.selectDevice)

  if (devices.length <= 1) {
    return (
      <span className="text-sm font-semibold text-ink-muted">
        {devices[0]?.name ?? 'No device'}
      </span>
    )
  }
  return (
    <select
      className="rounded-[14px] border-2 border-card-border bg-card px-3.5 py-2 text-sm font-semibold text-ink-soft"
      value={activeDeviceId ?? ''}
      onChange={(e) => selectDevice(e.target.value)}
      aria-label="MIDI input device"
    >
      {devices.map((device) => (
        <option key={device.id} value={device.id}>
          {device.name}
        </option>
      ))}
    </select>
  )
}
