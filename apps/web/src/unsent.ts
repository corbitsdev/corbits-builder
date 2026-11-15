import { useRef, useState, type SetStateAction } from "react";

type UnsentStorage = () => Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readUnsent(
  key: string,
  storage: UnsentStorage = () => sessionStorage,
): string {
  try {
    const stored = storage().getItem(key);
    return stored === null ? "" : stored;
  } catch {
    // A private window can refuse storage; the input then starts empty and works in memory.
    return "";
  }
}

export function writeUnsent(
  key: string,
  value: string,
  storage: UnsentStorage = () => sessionStorage,
): void {
  try {
    if (value === "") storage().removeItem(key);
    else storage().setItem(key, value);
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
  const latest = useRef(value);
  return [
    value,
    (next) => {
      latest.current = typeof next === "function" ? next(latest.current) : next;
      writeUnsent(key, latest.current);
      setValue(latest.current);
    },
  ];
}
