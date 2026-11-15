/**
 * One area of browser storage, read live by every component that shows a value from it. When the
 * browser refuses the storage, values live in memory instead, so the page keeps working.
 */
export function createBrowserStore(area: () => Storage, lifetime: string) {
  const listeners = new Set<() => void>();
  const inMemory = new Map<string, string | null>();

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      window.addEventListener("storage", listener);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", listener);
      };
    },

    read(key: string): string | null {
      const held = inMemory.get(key);
      if (held !== undefined) return held;
      try {
        return area().getItem(key);
      } catch (error) {
        console.warn(
          `Browser storage is unavailable; "${key}" lasts ${lifetime}.`,
          error,
        );
        inMemory.set(key, null);
        return null;
      }
    },

    /** Stores the value, or forgets the key when the value is null. */
    write(key: string, value: string | null): void {
      try {
        if (value === null) area().removeItem(key);
        else area().setItem(key, value);
        inMemory.delete(key);
      } catch (error) {
        // Typing writes on every keystroke, so a refusal is reported the first time only.
        if (!inMemory.has(key))
          console.warn(
            `Browser storage refused "${key}"; it lasts ${lifetime}.`,
            error,
          );
        inMemory.set(key, value);
      }
      for (const listener of listeners) listener();
    },
  };
}
