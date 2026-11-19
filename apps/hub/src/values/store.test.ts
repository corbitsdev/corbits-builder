import { expect, test } from "bun:test";
import { CATALOG } from "../plugins/catalog.ts";
import { codeProvenance, readStoredValues, type ValueStore } from "./store.ts";

// A project's store in memory, counting what was added to it.
function memoryStore(
  stored: Record<string, unknown>,
  code: Awaited<ReturnType<ValueStore["code"]>>,
) {
  const added: Readonly<Record<string, unknown>>[] = [];
  const store: ValueStore = {
    read: async () => stored,
    code: async () => code,
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
  const { store, added } = memoryStore(
    { "brand.guidelines": "plain" },
    "built",
  );

  const first = await readStoredValues(store);
  expect(first).toEqual({
    "brand.guidelines": "plain",
    "stack.starter": "web-app",
    "stack.checks": web.checks.join("\n"),
    "stack.run": web.run,
    "stack.production": web.production,
  });
  expect(added).toHaveLength(1);

  expect(await readStoredValues(store)).toEqual(first);
  expect(added).toHaveLength(1);
});

test("a project with no code, imported code, or one that recorded how its code started, gets nothing", async () => {
  const empty = memoryStore({}, "none");
  expect(await readStoredValues(empty.store)).toEqual({});
  expect(empty.added).toHaveLength(0);

  const imported = memoryStore({}, "imported");
  expect(await readStoredValues(imported.store)).toEqual({});
  expect(imported.added).toHaveLength(0);

  const bare = memoryStore({ "stack.starter": null }, "built");
  expect(await readStoredValues(bare.store)).toEqual({ "stack.starter": null });
  expect(bare.added).toHaveLength(0);
});

test("a project that recorded its starter before projects recorded production gets the starter's, once", async () => {
  const web = CATALOG.appStarters.get("web-app")!;
  const recorded = { "stack.starter": "web-app", "stack.run": web.run };
  const { store, added } = memoryStore({ ...recorded }, "built");

  expect(await readStoredValues(store)).toEqual({
    ...recorded,
    "stack.production": web.production,
  });
  await readStoredValues(store);
  expect(added).toHaveLength(1);

  // A starter that declares no production, or one the project replaced, adds nothing.
  const bare = memoryStore({ "stack.starter": "bare" }, "built");
  expect(await readStoredValues(bare.store)).toEqual({
    "stack.starter": "bare",
  });
  const kept = memoryStore(
    { "stack.starter": "web-app", "stack.production": null },
    "built",
  );
  await readStoredValues(kept.store);
  expect(bare.added).toHaveLength(0);
  expect(kept.added).toHaveLength(0);
});

for (const { metadata, expected } of [
  { metadata: { source: "check", bytes: 10 }, expected: "built" },
  { metadata: { source: "snapshot", bytes: 10 }, expected: "built" },
  { metadata: { source: "import", bytes: 10 }, expected: "imported" },
  { metadata: undefined, expected: "unknown" },
  { metadata: null, expected: "unknown" },
  { metadata: { source: "check" }, expected: "unknown" },
  { metadata: { source: "other", bytes: 10 }, expected: "unknown" },
]) {
  test(`stored first-version metadata ${JSON.stringify(metadata)} has provenance ${expected}`, async () => {
    const provenance = codeProvenance(metadata);
    expect(provenance).toBe(expected);
    const { store, added } = memoryStore({}, provenance);
    const values = await readStoredValues(store);
    if (expected === "built") {
      expect(values["stack.starter"]).toBe("web-app");
      expect(added).toHaveLength(1);
    } else {
      expect(values).toEqual({});
      expect(added).toHaveLength(0);
    }
  });
}
