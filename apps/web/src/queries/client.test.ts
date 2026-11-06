import { afterAll, expect, mock, test } from "bun:test";

const realIdb = { ...(await import("idb-keyval")) };
const stored = new Map<string, unknown>();
mock.module("idb-keyval", () => ({
  get: (key: string) => Promise.resolve(stored.get(key)),
  set: (key: string, value: unknown) => {
    stored.set(key, value);
    return Promise.resolve();
  },
  del: (key: string) => {
    stored.delete(key);
    return Promise.resolve();
  },
}));
afterAll(() => {
  mock.module("idb-keyval", () => realIdb);
});

const { forgetQueryCache, queryCacheReady, queryClient } =
  await import("./client.ts");

test("forgetting the cache leaves nothing of the last person, in memory or saved", async () => {
  await queryCacheReady;
  queryClient.setQueryData(["projects"], { projects: [{ id: "theirs" }] });
  await Bun.sleep(1_100);
  expect(JSON.stringify([...stored.values()])).toContain("theirs");

  await forgetQueryCache();
  await Bun.sleep(1_100);

  expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  expect(JSON.stringify([...stored.values()])).not.toContain("theirs");
});
