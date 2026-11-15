import { expect, test } from "bun:test";
import { readUnsent, writeUnsent } from "./unsent.ts";

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
  const access = () => storage;
  writeUnsent("unsent:composer:one", "  unfinished message\n", access);
  expect(readUnsent("unsent:composer:one", access)).toBe(
    "  unfinished message\n",
  );
  expect(readUnsent("unsent:composer:two", access)).toBe("");
  writeUnsent("unsent:composer:one", "", access);
  expect(storage.items.size).toBe(0);
});

test("storage that refuses every call leaves the input empty and usable", () => {
  const refuse = () => {
    throw new Error("Storage unavailable");
  };
  expect(readUnsent("draft", refuse)).toBe("");
  expect(() => writeUnsent("draft", "still writing", refuse)).not.toThrow();
});
