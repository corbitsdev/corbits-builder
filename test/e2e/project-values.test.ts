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
}, 120_000);

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

test("a private value reaches only someone who manages the project, and is unset to a reader", async () => {
  const { projectId, person, path } = await hub.seedProject("Kept");
  const keep = {
    link: "https://dash.example.com/claim?token=e2e-only-keep-token",
    until: "2026-11-18T12:00:00.000Z",
    place: "Example Host",
  };
  await hub.call("POST", `${path}/values`, {
    values: { "publish.keep": keep },
  });
  const keys = "keys=publish.keep,publish.release";

  expect(await hub.json(hub.call("GET", `${path}/values?${keys}`))).toEqual({
    values: { "publish.keep": keep, "publish.release": null },
  });
  const reader = await hub.seedMember(person, projectId, ["read"]);
  const read = hub.call("GET", `${path}/values?${keys}`, undefined, reader);
  expect(await hub.json(read)).toEqual({
    values: { "publish.keep": null, "publish.release": null },
  });
});

test("someone who manages the project clears a private value, and a reader may not", async () => {
  const { projectId, person, path } = await hub.seedProject("Cleared");
  const keep = {
    link: "https://dash.example.com/claim?token=e2e-only-keep-token",
    until: "2026-11-18T12:00:00.000Z",
    place: "Example Host",
  };
  await hub.call("POST", `${path}/values`, {
    values: { "publish.keep": keep },
  });
  const reader = await hub.seedMember(person, projectId, ["read"]);

  await expect(
    hub.call(
      "POST",
      `${path}/values`,
      { values: { "publish.keep": null } },
      reader,
    ),
  ).rejects.toThrow("HTTP 403");
  expect(
    await hub.json(
      hub.call("POST", `${path}/values`, { values: { "publish.keep": null } }),
    ),
  ).toEqual({ values: { "publish.keep": null } });
  expect(
    await hub.json(hub.call("GET", `${path}/values?keys=publish.keep`)),
  ).toEqual({ values: { "publish.keep": null } });
});
