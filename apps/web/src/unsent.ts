/** Text a person has typed but not sent, kept for this browser tab so a reload does not lose it. */
import { useCallback, useSyncExternalStore, type SetStateAction } from "react";
import { createBrowserStore } from "./browser-store.ts";

const store = createBrowserStore(
  () => sessionStorage,
  "until this page reloads",
);

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
