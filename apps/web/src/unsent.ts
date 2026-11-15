import { useEffect, useState, type SetStateAction } from "react";

export function readUnsent(key: string): string {
  try {
    const stored = sessionStorage.getItem(key);
    return stored === null ? "" : stored;
  } catch (error) {
    console.warn(
      `Browser storage is unavailable; "${key}" starts empty for this window.`,
      error,
    );
    return "";
  }
}

export function writeUnsent(key: string, value: string): void {
  try {
    if (value === "") sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // A private window can refuse storage; the input still works in memory.
  }
}

/**
 * Text a person has typed but not sent, kept for this browser tab so a reload does not lose it.
 * Setting it to the empty string, as sending does, forgets it.
 */
export function useUnsent(
  key: string,
): [string, (value: SetStateAction<string>) => void] {
  const [value, setValue] = useState(() => readUnsent(key));
  useEffect(() => {
    writeUnsent(key, value);
  }, [key, value]);
  return [value, setValue];
}
