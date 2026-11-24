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

const build = {
  id: "build",
  title: "Write the manual",
  plugin: "writer",
  action: "write",
  input: {},
  askFirst: false,
  optional: true,
};

// A project with the build step on its plan, and the credentials its coordinator calls the hub with.
async function planned() {
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
  await hub.call("PUT", `${path}/plan`, { steps: [build] });
  return { path, run: { authorization: `Bearer ${delivery!.token}` } };
}

// The person's change to a step, which the hub stores and then mails to the coordinator; that run is
// not hosted here, so only the mail fails.
const personChanges = (change: Promise<Response>) =>
  expect(change).rejects.toThrow("run_mail_500");

const stored = async (path: string) =>
  (await hub.json<StoredPlan>(hub.call("GET", `${path}/plan`))).steps[0];

test("a coordinator's save keeps the person's ask me first and cannot drop the step it holds", async () => {
  const { path, run } = await planned();
  await personChanges(
    hub.call("POST", `${path}/plan/steps/build/ask-first`, { askFirst: true }),
  );

  await hub.call("PUT", `${path}/plan`, { steps: [build] }, run);
  expect(await stored(path)).toMatchObject({ id: "build", askFirst: true });
  await expect(
    hub.call("PUT", `${path}/plan`, { steps: [] }, run),
  ).rejects.toThrow("HTTP 409");
});

test("a person's decline is never lost to a coordinator's save made at the same time", async () => {
  const { path, run } = await planned();
  // The decline starts a little later each round, so that some round lands it between the save's
  // read of the plan and its write.
  const decline = async (delay: number) => {
    await Bun.sleep(delay);
    await personChanges(hub.call("POST", `${path}/plan/steps/build/decline`));
  };
  for (let round = 0; round < 40; round++) {
    await Promise.all([
      decline(round % 20),
      hub.call("PUT", `${path}/plan`, { steps: [build] }, run),
    ]);
    expect(await stored(path)).toHaveProperty("declined");
    await personChanges(hub.call("POST", `${path}/plan/steps/build/undecline`));
  }
});
