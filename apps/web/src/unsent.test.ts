import { afterEach, expect, spyOn, test } from "bun:test";
import { readUnsent, writeUnsent } from "./unsent.ts";

const originalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "sessionStorage",
);
afterEach(() => {
  if (originalStorage)
    Object.defineProperty(globalThis, "sessionStorage", originalStorage);
  else Reflect.deleteProperty(globalThis, "sessionStorage");
});

function fakeStorage() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
    removeItem: (key: string) => {
      items.delete(key);
    },
  };
}

test("unsent text is read back for its own key and forgotten once it is empty", () => {
  const storage = fakeStorage();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage,
  });
  writeUnsent("unsent:composer:one", "  unfinished message\n");
  expect(readUnsent("unsent:composer:one")).toBe("  unfinished message\n");
  expect(readUnsent("unsent:composer:two")).toBe("");
  writeUnsent("unsent:composer:one", "");
  expect(storage.items.size).toBe(0);
});

test("storage that refuses every call keeps the text in memory and says so once", () => {
  const refuse = () => {
    throw new Error("Storage unavailable");
  };
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get: refuse,
  });
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(readUnsent("draft")).toBe("");
    writeUnsent("draft", "still writing");
    writeUnsent("draft", "still writing more");
    expect(readUnsent("draft")).toBe("still writing more");
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    warn.mockRestore();
  }
});
