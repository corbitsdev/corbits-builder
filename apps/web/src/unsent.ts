/** Text a person has typed but not sent, kept for this browser tab so a reload does not lose it. */
import { useCallback, useSyncExternalStore, type SetStateAction } from "react";
import { createBrowserStore } from "./browser-store.ts";

const store = createBrowserStore(
  () => sessionStorage,
  "until this page reloads",
);

/** Where a project's prompt box keeps what is typed and not yet sent. */
export const composerKey = (projectId: string) =>
  `unsent:composer:${projectId}`;

/** Moves what is kept under one key to another, once the place it belongs exists. */
export function moveUnsent(from: string, to: string): void {
  const value = store.read(from);
  if (value === null) return;
  store.write(to, value);
  store.write(from, null);
}

export function useUnsent(
  key: string,
): [string, (value: SetStateAction<string>) => void] {
  const read = useCallback(() => {
    const stored = store.read(key);
    return stored === null ? "" : stored;
  }, [key]);
  const value = useSyncExternalStore(store.subscribe, read, read);
  const set = useCallback(
    (next: SetStateAction<string>) => {
      const value = typeof next === "function" ? next(read()) : next;
      store.write(key, value === "" ? null : value);
    },
    [key, read],
  );
  return [value, set];
}
