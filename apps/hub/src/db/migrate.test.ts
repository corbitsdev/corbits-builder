import { expect, test } from "bun:test";
import journal from "./migrations/meta/_journal.json";

// 0038 reapplies 0037 on databases that skipped it, so 0037 stays as shipped.
const repairedOutOfOrder = new Set(["0037_approval_round"]);

// The migrator skips any migration whose `when` is not later than the newest
// one already applied, so an out-of-order entry never runs on existing databases.
test("migration journal timestamps strictly increase", () => {
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  let latest = 0;
  const outOfOrder: string[] = [];
  for (const entry of entries) {
    if (entry.when <= latest) outOfOrder.push(entry.tag);
    latest = Math.max(latest, entry.when);
  }
  expect(outOfOrder).toEqual([...repairedOutOfOrder]);
});
