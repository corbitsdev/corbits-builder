/**
 * Text a person has typed but not sent, kept for this browser tab so a reload does not lose it.
 * When storage is unavailable it lives in memory until the page reloads.
 */
import { useCallback, useSyncExternalStore, type SetStateAction } from "react";

const listeners = new Set<() => void>();
const inMemory = new Map<string, string>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readUnsent(key: string): string {
  const held = inMemory.get(key);
  if (held !== undefined) return held;
  try {
    const stored = sessionStorage.getItem(key);
    return stored === null ? "" : stored;
  } catch (error) {
    console.warn(
      `Browser storage is unavailable; "${key}" lasts until this page reloads.`,
      error,
    );
    inMemory.set(key, "");
    return "";
  }
}

export function writeUnsent(key: string, value: string): void {
  try {
    if (value === "") sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
    inMemory.delete(key);
  } catch (error) {
    // Typing writes on every keystroke, so a refusal is reported the first time only.
    if (!inMemory.has(key))
      console.warn(
        `Browser storage refused "${key}"; it lasts until this page reloads.`,
        error,
      );
    inMemory.set(key, value);
  }
  for (const listener of listeners) listener();
}

export function useUnsent(
  key: string,
): [string, (value: SetStateAction<string>) => void] {
  const read = () => readUnsent(key);
  const value = useSyncExternalStore(subscribe, read, read);
  const set = useCallback(
    (next: SetStateAction<string>) =>
      writeUnsent(
        key,
        typeof next === "function" ? next(readUnsent(key)) : next,
      ),
    [key],
  );
  return [value, set];
}
