// Join truthy class-name parts. Tiny local helper so the v9 primitives and
// screens can compose Tailwind classes without a dependency.
export function cx(...parts: (string | false | undefined | null)[]): string {
  return parts.filter(Boolean).join(' ')
}
