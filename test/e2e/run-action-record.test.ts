import { afterAll, beforeAll, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { startInProcessHub } from "./support/in-process-hub.ts";

let hub: Awaited<ReturnType<typeof startInProcessHub>>;

beforeAll(async () => {
  hub = await startInProcessHub();
});

afterAll(() => hub?.close());

// A writer's run, and the coordinator's record of the action it started that run for.
async function writerRun() {
  const { person, path } = await hub.seedProject("Run actions");
  const run = await hub.seedRun(person, "writer", true);
  const record = (plugin: string, action: string) =>
    hub.call("POST", `${path}/run-actions`, { runId: run.id, plugin, action });
  const stored = async () => {
    const rows = await hub.db.execute<{ plugin: string; action: string }>(
      sql`select plugin, action from sb_run_action where run_id = ${run.id}`,
    );
    return [...rows];
  };
  return { record, stored };
}

test("a run's action is recorded when the run plays the role that action starts", async () => {
  const { record, stored } = await writerRun();
  await record("writer", "write");
  expect(await stored()).toEqual([{ plugin: "writer", action: "write" }]);
});

test("a run is not recorded under another plugin's action", async () => {
  const { record, stored } = await writerRun();
  await expect(record("designer", "mockup")).rejects.toThrow(
    "run_not_started_for_action",
  );
  expect(await stored()).toEqual([]);
});

test("a run is not recorded under an action of its plugin that starts another agent", async () => {
  const { record, stored } = await writerRun();
  await expect(record("writer", "review")).rejects.toThrow(
    "run_not_started_for_action",
  );
  expect(await stored()).toEqual([]);
});

test("a run's first recorded action stays when a different one is recorded after it", async () => {
  const { record, stored } = await writerRun();
  await record("writer", "write");
  await record("writer", "write-build-plan");
  expect(await stored()).toEqual([{ plugin: "writer", action: "write" }]);
});
