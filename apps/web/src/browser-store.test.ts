import { afterEach, expect, spyOn, test } from "bun:test";
import { createBrowserStore } from "./browser-store.ts";

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

test("a value is read back for its own key and forgotten when written as null", () => {
  const storage = fakeStorage();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: storage,
  });
  const store = createBrowserStore(() => sessionStorage, "until reload");
  store.write("one", "  unfinished message\n");
  expect(store.read("one")).toBe("  unfinished message\n");
  expect(store.read("two")).toBeNull();
  store.write("one", null);
  expect(storage.items.size).toBe(0);
});

test("storage that refuses every call keeps the value in memory and says so once", () => {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    get: () => {
      throw new Error("Storage unavailable");
    },
  });
  const store = createBrowserStore(() => sessionStorage, "until reload");
  const warn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(store.read("draft")).toBeNull();
    store.write("draft", "still writing");
    store.write("draft", "still writing more");
    expect(store.read("draft")).toBe("still writing more");
    expect(warn).toHaveBeenCalledTimes(1);
  } finally {
    warn.mockRestore();
  }
});
