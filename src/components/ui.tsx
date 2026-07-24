// Shared UI primitives for the v9 visual language (DESIGN.md §7): chunky
// 2px-bordered rounded panels with a hard offset shadow on a dark navy
// surface, green primary action. Reference mock: doc/Prototype.dc.html. These
// are pure presentation — no store/MIDI knowledge — adopted screen by screen.
//
// Convention: base classes deliberately omit padding and text-size so callers
// supply them via `className` without fighting Tailwind's utility ordering
// (the prototype uses many different paddings per element).

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { cx } from './cx'

// A raised panel: 2px border, hard offset shadow, rounded. Padding is the
// caller's (cards vary 12–26px in the mock).
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        'rounded-[20px] border-2 border-card-border bg-card shadow-hard',
        className,
      )}
      {...rest}
    />
  )
}

// The small uppercase tracking label above a group ("CONTINUE", "IN PLAY").
export function SectionLabel({
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cx(
        'text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-muted',
        className,
      )}
      {...rest}
    />
  )
}

type RaisedVariant = 'primary' | 'outline' | 'raised'
type RaisedSize = 'sm' | 'md' | 'lg'

const RAISED_VARIANTS: Record<RaisedVariant, string> = {
  // Green fill with a green hard shadow — the one primary action per screen.
  primary:
    'border-2 border-transparent bg-primary text-primary-ink shadow-primary font-extrabold',
  // Quiet bordered action (End, Home, Change).
  outline:
    'border-2 border-muted-border bg-transparent text-ink-muted font-semibold',
  // Card-colored raised control (device picker, session label).
  raised:
    'border-2 border-card-border bg-card text-ink-soft shadow-hard-sm font-semibold',
}

const RAISED_SIZES: Record<RaisedSize, string> = {
  sm: 'rounded-[14px] px-4 py-2 text-sm',
  md: 'rounded-[16px] px-4 py-2.5 text-base',
  lg: 'rounded-[18px] px-5 py-3.5 text-xl',
}

// A chunky pressable button. `active:translate-y` presses it into its own
// hard shadow for a tactile feel.
export function RaisedButton({
  variant = 'raised',
  size = 'md',
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: RaisedVariant
  size?: RaisedSize
}) {
  return (
    <button
      className={cx(
        'inline-flex items-center justify-center gap-2 transition-transform',
        'active:translate-y-[2px] disabled:cursor-not-allowed disabled:opacity-50',
        RAISED_VARIANTS[variant],
        RAISED_SIZES[size],
        className,
      )}
      {...rest}
    />
  )
}

type ChipTone = 'default' | 'info' | 'locked'

const CHIP_TONES: Record<ChipTone, { on: string; off: string }> = {
  default: {
    on: 'border-primary bg-primary-tint text-primary-light',
    off: 'border-muted-border bg-surface text-ink-soft',
  },
  info: {
    on: 'border-info-border bg-info-tint text-info-light',
    off: 'border-info-border bg-info-tint text-info-light',
  },
  locked: {
    on: 'border-dashed border-muted-border text-ink-faint',
    off: 'border-dashed border-muted-border text-ink-faint',
  },
}

// A pill: a labeled tag or a selectable segment (mode/length/size choosers).
// Padding + text size come from `className`. Renders a <button> when onClick
// is given, else a <span>.
export function Chip({
  selected = false,
  tone = 'default',
  className,
  onClick,
  children,
  ...rest
}: {
  selected?: boolean
  tone?: ChipTone
  className?: string
  onClick?: () => void
  children?: ReactNode
} & Omit<HTMLAttributes<HTMLElement>, 'onClick' | 'children'>) {
  const palette = CHIP_TONES[tone]
  const classes = cx(
    'inline-flex items-center gap-2 rounded-xl border-2',
    selected ? 'font-extrabold' : 'font-semibold',
    selected ? palette.on : palette.off,
    className,
  )
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={classes} {...rest}>
        {children}
      </button>
    )
  }
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  )
}

// A pill switch (on = green track, knob to the right). Controlled.
export function Toggle({
  checked,
  onChange,
  className,
  ...rest
}: {
  checked: boolean
  onChange: (next: boolean) => void
  className?: string
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'onChange'>) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cx(
        'inline-flex h-7 w-12 flex-none items-center rounded-full border-2 p-0.5 transition-colors',
        checked
          ? 'justify-end border-primary bg-primary'
          : 'justify-start border-muted-border bg-track',
        className,
      )}
      {...rest}
    >
      <span
        className={cx(
          'block h-[18px] w-[18px] rounded-full transition-colors',
          checked ? 'bg-primary-ink' : 'bg-ink-muted',
        )}
      />
    </button>
  )
}

// − value + numeric stepper. The value is pre-formatted by the caller.
export function Stepper({
  value,
  onDecrement,
  onIncrement,
  decDisabled = false,
  incDisabled = false,
  label,
}: {
  value: string
  onDecrement: () => void
  onIncrement: () => void
  decDisabled?: boolean
  incDisabled?: boolean
  label?: string
}) {
  const btn =
    'flex h-[30px] w-[30px] items-center justify-center rounded-[10px] border-2 border-muted-border bg-transparent text-base font-extrabold leading-none text-ink-soft transition-transform active:translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={onDecrement}
        disabled={decDisabled}
        aria-label={label ? `Decrease ${label}` : 'Decrease'}
        className={btn}
      >
        −
      </button>
      <span className="min-w-16 text-center text-ink tabular-nums">
        {value}
      </span>
      <button
        type="button"
        onClick={onIncrement}
        disabled={incDisabled}
        aria-label={label ? `Increase ${label}` : 'Increase'}
        className={btn}
      >
        +
      </button>
    </div>
  )
}
