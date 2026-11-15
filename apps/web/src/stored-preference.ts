/**
 * A person's preference in this browser, read live by every component that
 * shows it and by other windows through the `storage` event. When storage is
 * unavailable the choice lives in memory until the window closes.
 */
import { useSyncExternalStore } from "react";
import { createBrowserStore } from "./browser-store.ts";

const store = createBrowserStore(
  () => localStorage,
  "until this window closes",
);

export const readStoredPreference = store.read;

export function writeStoredPreference(key: string, value: string): void {
  store.write(key, value);
}

/** The stored value as `parse` reads it, or `fallback` when nothing valid is stored. */
export function useStoredPreference<T extends string>(
  key: string,
  parse: (raw: string) => T | null,
  fallback: T,
): T {
  const read = () => {
    const raw = readStoredPreference(key);
    return (raw === null ? null : parse(raw)) ?? fallback;
  };
  return useSyncExternalStore(store.subscribe, read, () => fallback);
}
