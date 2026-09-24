import { describe, expect, it } from 'vitest'
import { MAX_OCTAVE_SHIFT, QwertyKeyboard } from './devKeyboard'

function setup() {
  const events: string[] = []
  const keyboard = new QwertyKeyboard({
    noteOn: (note) => events.push(`on ${note}`),
    noteOff: (note) => events.push(`off ${note}`),
  })
  const tap = (key: string) => {
    keyboard.keyDown(key)
    keyboard.keyUp(key)
  }
  return { keyboard, events, tap }
}

describe('QwertyKeyboard (dev ?midi=sim)', () => {
  it('plays the home row from C4 to F5', () => {
    const { events, tap } = setup()
    tap('a')
    tap('W')
    tap("'")
    expect(events).toEqual([
      'on 60',
      'off 60',
      'on 61',
      'off 61',
      'on 77',
      'off 77',
    ])
  })

  it('shifts the row by octaves with Z and X', () => {
    const { keyboard, events, tap } = setup()
    tap('x')
    tap('a')
    tap('z')
    tap('z')
    tap('a')
    expect(keyboard.octave).toBe(-1)
    expect(events).toEqual(['on 72', 'off 72', 'on 48', 'off 48'])
  })

  it('stops at three octaves either way', () => {
    const { keyboard, tap } = setup()
    for (let i = 0; i < 10; i++) tap('x')
    expect(keyboard.octave).toBe(MAX_OCTAVE_SHIFT)
    for (let i = 0; i < 20; i++) tap('z')
    expect(keyboard.octave).toBe(-MAX_OCTAVE_SHIFT)
  })

  it('releases the note a key pressed, even after a shift', () => {
    const { keyboard, events } = setup()
    keyboard.keyDown('a')
    keyboard.keyDown('x')
    keyboard.keyUp('a')
    expect(events).toEqual(['on 60', 'off 60'])
  })

  it('ignores unmapped keys and a key already down', () => {
    const { keyboard, events } = setup()
    keyboard.keyDown('q')
    keyboard.keyDown('a')
    keyboard.keyDown('a')
    keyboard.keyUp('q')
    expect(events).toEqual(['on 60'])
  })
})
