import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { toolConsumer } from "@intx/authz";
import { createNoopCredentialCipher } from "@intx/crypto";
import { createRunTokenStore } from "@intx/db";
import { grant } from "@intx/db/schema";
import type { StoredPlan } from "@corbits-builder/schemas/plan";
import { startInProcessHub } from "./support/in-process-hub.ts";

let hub: Awaited<ReturnType<typeof startInProcessHub>>;

beforeAll(async () => {
  hub = await startInProcessHub();
}, 120_000);

afterAll(() => hub?.close());

const write = {
  id: "write",
  title: "Write the manual",
  plugin: "writer",
  action: "write",
  input: {},
  askFirst: false,
};
const review = {
  id: "review",
  title: "Review the manual",
  plugin: "writer",
  action: "review",
  input: {
    kind: "manual",
    instruction: "Check the manual reads well for a first-time reader.",
  },
  askFirst: false,
};
const extra = {
  id: "extra",
  title: "Write a second manual",
  plugin: "writer",
  action: "write",
  input: {},
  askFirst: false,
  optional: true,
};
const approved = {
  id: "approved",
  title: "Review the approved manual",
  plugin: "writer",
  action: "review",
  input: review.input,
  askFirst: false,
  approval: { of: ["manual"], when: "required" },
};
// The same step, saved afresh without its id.
const approval = {
  title: approved.title,
  plugin: approved.plugin,
  action: approved.action,
  input: approved.input,
  askFirst: false,
  approval: approved.approval,
};

// A project with the person's plan saved, and the credentials its coordinator calls the hub with.
async function planned(steps: object[]) {
  const { projectId, person, path } = await hub.seedProject("Plan");
  const coordinator = await hub.seedRun(person, "coordinator", true);
  await hub.db.execute(
    sql`insert into project_coordinator (run_id, project_id, registered_by) values (${coordinator.id}, ${projectId}, ${person.principalId})`,
  );
  for (const action of ["read", "manage"])
    await hub.db.insert(grant).values({
      id: randomUUID(),
      tenantId: person.tenantId,
      principalId: coordinator.principalId,
      resource: `sb-project:${projectId}`,
      action,
      effect: "allow",
      origin: "system",
    });
  const tokens = createRunTokenStore({
    db: hub.db,
    cipher: createNoopCredentialCipher(),
  });
  await tokens.mintIfAbsent(
    { principalId: coordinator.principalId, consumers: [toolConsumer("plan")] },
    hub.db,
  );
  const [delivery] = await tokens.loadDelivery(coordinator.principalId);
  await hub.call("PUT", `${path}/plan`, { steps });
  // A specialist's run for the step that has finished.
  const finished = async (step: string) => {
    const run = await hub.seedRun(person, "writer");
    await hub.db.execute(
      sql`update workflow_run set status = 'completed', cancellation_reason = null where id = ${run.id}`,
    );
    await hub.db.execute(
      sql`insert into sb_run_action (run_id, tenant_id, project_id, plugin, action, plan_step) values (${run.id}, ${person.tenantId}, ${projectId}, 'writer', 'write', ${step})`,
    );
  };
  return {
    path,
    finished,
    run: { authorization: `Bearer ${delivery!.token}` },
  };
}

const storedIds = async (path: string) =>
  (await hub.json<StoredPlan>(hub.call("GET", `${path}/plan`))).steps.map(
    ({ id }) => id,
  );

test("the coordinator cannot remove or replace a step waiting for the person's approval", async () => {
  const { path, run } = await planned([write, approved]);
  for (const steps of [[write], [], [write, approval]])
    await expect(
      hub.call("PUT", `${path}/plan`, { steps }, run),
    ).rejects.toThrow("HTTP 409");
  expect(await storedIds(path)).toEqual(["write", "approved"]);

  await hub.call("PUT", `${path}/plan`, { steps: [write] });
  expect(await storedIds(path)).toEqual(["write"]);
});

test("before any step has run, the coordinator can remove a required step", async () => {
  const { path, run } = await planned([write, review]);
  await hub.call("PUT", `${path}/plan`, { steps: [write] }, run);
  expect(await storedIds(path)).toEqual(["write"]);
});

test("once a plan is under way, the coordinator keeps its required unfinished steps", async () => {
  const { path, run, finished } = await planned([write, review, extra]);
  await finished("write");

  await expect(
    hub.call("PUT", `${path}/plan`, { steps: [write, extra] }, run),
  ).rejects.toThrow("HTTP 409");
  expect(await storedIds(path)).toEqual(["write", "review", "extra"]);

  await hub.call("PUT", `${path}/plan`, { steps: [write, review] }, run);
  expect(await storedIds(path)).toEqual(["write", "review"]);
  await hub.call("PUT", `${path}/plan`, { steps: [write, review, extra] }, run);
  expect(await storedIds(path)).toEqual(["write", "review", "extra"]);
});

test("the coordinator can remove a step the person cancelled, even one they asked to be consulted on", async () => {
  const consulted = {
    id: review.id,
    title: review.title,
    plugin: review.plugin,
    action: review.action,
    input: review.input,
    askFirst: true,
    cancelled: { by: "person", at: new Date().toISOString() },
  };
  const { path, run } = await planned([write, consulted]);
  await hub.call("PUT", `${path}/plan`, { steps: [write] }, run);
  expect(await storedIds(path)).toEqual(["write"]);
});
