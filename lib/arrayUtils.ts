/**
 * Returns a copy of `items` with the element at `from` moved to `to`.
 * Out-of-range indices return an unchanged copy, so callers can wire
 * "move up/down" buttons without bounds-checking at every call site.
 */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const copy = [...items];
  if (from === to || from < 0 || to < 0 || from >= copy.length || to >= copy.length) {
    return copy;
  }
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  return copy;
}
