import { useEffect, useRef } from "react";

/**
 * What this session has learned about a room so far. Each render adds to what earlier renders
 * stored without changing it, and stores the sum only once React commits the render, so a render
 * React throws away leaves nothing behind.
 */
export function useSessionMemory<T>(empty: T, grow: (known: T) => T): T {
  const kept = useRef(empty);
  const value = grow(kept.current);
  useEffect(() => {
    kept.current = value;
  }, [value]);
  return value;
}

/**
 * `known` with these entries set. Only a new entry, or one that differs by `same`, makes a new
 * map, so a render that learns nothing returns `known` and memos on it don't rerun.
 */
export function withEntries<K, V>(
  known: ReadonlyMap<K, V>,
  entries: Iterable<readonly [K, V]>,
  same: (kept: V, next: V) => boolean,
): ReadonlyMap<K, V> {
  let grown: Map<K, V> | undefined;
  for (const [key, next] of entries) {
    const kept = (grown ?? known).get(key);
    if (kept !== undefined && same(kept, next)) continue;
    grown ??= new Map(known);
    grown.set(key, next);
  }
  return grown ?? known;
}
