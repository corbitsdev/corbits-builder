import { afterAll, beforeAll, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { startInProcessHub } from "./support/in-process-hub.ts";

let hub: Awaited<ReturnType<typeof startInProcessHub>>;

beforeAll(async () => {
  hub = await startInProcessHub();
}, 120_000);

afterAll(() => hub?.close());

test("a finished step stays done however many runs end after it", async () => {
  const { projectId, person, path } = await hub.seedProject("Plan");
  const finished = async (step: string | null) => {
    const run = await hub.seedRun(person, "writer");
    await hub.db.execute(
      sql`update workflow_run set status = 'completed', cancellation_reason = null where id = ${run.id}`,
    );
    await hub.db.execute(
      sql`insert into sb_run_action (run_id, tenant_id, project_id, plugin, action, plan_step) values (${run.id}, ${person.tenantId}, ${projectId}, 'writer', 'review', ${step})`,
    );
  };
  const state = async () =>
    (
      await hub.json<{ steps: { state: string }[] }>(
        hub.call("GET", `${path}/plan`),
      )
    ).steps[0]?.state;

  await hub.call("PUT", `${path}/plan`, {
    steps: [
      {
        id: "review",
        title: "Review the manual",
        plugin: "writer",
        action: "review",
        input: {
          kind: "manual",
          instruction: "Check the manual reads well for a first-time reader.",
        },
        askFirst: false,
      },
    ],
  });
  await finished("review");
  expect(await state()).toBe("done");
  for (let each = 0; each < 11; each++) await finished(null);
  expect(await state()).toBe("done");
});
