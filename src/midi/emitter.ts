export interface Emitter<E> {
  subscribe(listener: (event: E) => void): () => void
  emit(event: E): void
}

export function createEmitter<E>(): Emitter<E> {
  const listeners = new Set<(event: E) => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emit(event) {
      for (const listener of [...listeners]) listener(event)
    },
  }
}
