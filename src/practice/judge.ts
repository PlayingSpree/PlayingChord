import type { RunShape } from '../theory'
import {
  AttemptLifecycle,
  type LifecycleHost,
  type LifecycleState,
} from './lifecycle'
import type { Prompt, ScalePrompt } from './prompts'
import { RunLifecycle } from './runLifecycle'

// A run is judged as a sequence (§6.6), everything else — chords and block
// scales — as a held set (§6.2). The choice is the prompt's, never the mode's.
export function isRunPrompt(
  prompt: Prompt,
): prompt is ScalePrompt & { shape: RunShape } {
  return prompt.kind === 'scale' && prompt.shape.kind === 'run'
}

// The one attempt machine the host sees: it deals each prompt to the machine
// that judges its kind and passes that machine's state through. Both machines
// see every held-set change, so whichever takes the next prompt knows what is
// already down; only the active one is heard, so a machine left behind by a
// switch can't speak for the prompt that replaced it.
export class PromptJudge {
  private readonly set: AttemptLifecycle
  private readonly run: RunLifecycle
  private active: 'set' | 'run' = 'set'

  constructor(host: LifecycleHost) {
    const heardWhen = (active: 'set' | 'run'): LifecycleHost => ({
      settings: () => host.settings(),
      now: () => host.now(),
      onState: (state) => {
        if (this.active === active) host.onState(state)
      },
      onAdvance: () => {
        if (this.active === active) host.onAdvance()
      },
      revealOnMisses: () => host.revealOnMisses?.() ?? true,
    })
    this.set = new AttemptLifecycle(heardWhen('set'))
    this.run = new RunLifecycle(heardWhen('run'))
  }

  get state(): LifecycleState {
    return this.machine().state
  }

  promptShown(prompt: Prompt): void {
    const next = isRunPrompt(prompt) ? 'run' : 'set'
    if (next !== this.active) {
      // Switch first, so the outgoing machine's reset goes unheard.
      const outgoing = this.machine()
      this.active = next
      outgoing.stop()
    }
    if (isRunPrompt(prompt)) this.run.promptShown(prompt)
    else this.set.promptShown(prompt)
  }

  heldChange(held: ReadonlySet<number>): void {
    this.set.heldChange(held)
    this.run.heldChange(held)
  }

  stop(): void {
    this.set.stop()
    this.run.stop()
  }

  private machine(): AttemptLifecycle | RunLifecycle {
    return this.active === 'run' ? this.run : this.set
  }
}
