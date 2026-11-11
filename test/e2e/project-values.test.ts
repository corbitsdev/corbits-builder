import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { toolConsumer } from "@intx/authz";
import { createNoopCredentialCipher } from "@intx/crypto";
import { createRunTokenStore } from "@intx/db";
import { grant } from "@intx/db/schema";
import { startInProcessHub } from "./support/in-process-hub.ts";

let hub: Awaited<ReturnType<typeof startInProcessHub>>;

beforeAll(async () => {
  hub = await startInProcessHub();
});

afterAll(() => hub?.close());

test("a coordinator's run token reads its own project's values and never saves them", async () => {
  const { projectId, person, path } = await hub.seedProject("Values");
  const other = await hub.seedProject("Other");
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
    {
      principalId: coordinator.principalId,
      consumers: [toolConsumer("question")],
    },
    hub.db,
  );
  const [delivery] = await tokens.loadDelivery(coordinator.principalId);
  const run = { authorization: `Bearer ${delivery!.token}` };
  const keys = "keys=look.font-primary,look.font-secondary";

  expect(
    await hub.json(hub.call("GET", `${path}/values?${keys}`, undefined, run)),
  ).toEqual({
    values: { "look.font-primary": null, "look.font-secondary": null },
  });
  await expect(
    hub.call(
      "POST",
      `${path}/values`,
      { values: { "look.font-primary": "Arial" } },
      run,
    ),
  ).rejects.toThrow("HTTP 401");
  await expect(
    hub.call("GET", `${other.path}/values?${keys}`, undefined, run),
  ).rejects.toThrow("HTTP 401");
});
