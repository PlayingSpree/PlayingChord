---
name: verify
description: How to launch and drive PlayingChord to verify changes at the browser surface.
---

# Verifying PlayingChord

Surface: browser GUI (Vite dev server). No test/typecheck runs here — drive the app.

## Launch

```sh
npm run dev          # background; serves http://localhost:5173
```

## Drive (headless browser)

```sh
npm i --no-save playwright-core   # npm prune afterwards to undo
```

Use `chromium.launch({ channel: 'msedge', headless: true })` — system Edge, no
browser download needed.

- **Simulated MIDI:** open `http://localhost:5173/?midi=sim` (dev builds only),
  then `page.keyboard.down/up('a'|'w'|'s'|...)` plays notes (A=C4 … P=D♯5, see
  `src/midi/devKeyboard.ts`). Held notes appear as chips / on the UI.
- **Real Web MIDI:** `context.grantPermissions(['midi', 'midi-sysex'], { origin })`.
  Granting only `'midi'` still rejects in Edge (Chromium gates all MIDI behind
  the sysex-level permission) → app shows the "denied" screen.
- **Unsupported browser:** `page.addInitScript(() => { delete Navigator.prototype.requestMIDIAccess })`.
- **Denied:** a fresh context with no grants auto-denies.

## Gotchas

- This machine usually has a real MIDI input ("SMC-PADPocket-Bt" Bluetooth pad),
  so the real-MIDI path lands on the app, not the "connect a keyboard" screen.
  Physical key presses can't be automated — ask the user for hardware checks.
- Kill the dev server via the process listening on port 5173 when done.
