import { expect, test } from "bun:test";
import { CATALOG } from "../plugins/catalog.ts";
import { readStoredValues, type ValueStore } from "./values.ts";

// A project's store in memory, counting what was added to it.
function memoryStore(stored: Record<string, unknown>, hasCode: boolean) {
  const added: Readonly<Record<string, unknown>>[] = [];
  const store: ValueStore = {
    read: async () => stored,
    hasCode: async () => hasCode,
    add: async (values) => {
      added.push(values);
      Object.assign(stored, values);
      return stored;
    },
  };
  return { store, added };
}

test("a project with saved code and no stack values reads, and keeps, the web starter's values", async () => {
  const web = CATALOG.appStarters.get("web-app")!;
  const { store, added } = memoryStore({ "brand.guidelines": "plain" }, true);

  const first = await readStoredValues(store);
  expect(first).toEqual({
    "brand.guidelines": "plain",
    "stack.starter": "web-app",
    "stack.checks": web.checks.join("\n"),
    "stack.run": web.run,
  });
  expect(added).toHaveLength(1);

  expect(await readStoredValues(store)).toEqual(first);
  expect(added).toHaveLength(1);
});

test("a project with no code, or one that recorded how its code started, gets nothing", async () => {
  const empty = memoryStore({}, false);
  expect(await readStoredValues(empty.store)).toEqual({});
  expect(empty.added).toHaveLength(0);

  const bare = memoryStore({ "stack.starter": null }, true);
  expect(await readStoredValues(bare.store)).toEqual({ "stack.starter": null });
  expect(bare.added).toHaveLength(0);
});
