import { useMidi } from '../store/midiStore'

export function DevicePicker() {
  const devices = useMidi((s) => s.devices)
  const activeDeviceId = useMidi((s) => s.activeDeviceId)
  const selectDevice = useMidi((s) => s.selectDevice)

  if (devices.length <= 1) {
    return (
      <span className="text-sm text-slate-400">
        {devices[0]?.name ?? 'No device'}
      </span>
    )
  }
  return (
    <select
      className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
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
