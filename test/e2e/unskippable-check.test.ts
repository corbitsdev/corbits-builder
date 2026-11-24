import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { startInProcessHub } from "./support/in-process-hub.ts";

let hub: Awaited<ReturnType<typeof startInProcessHub>>;

beforeAll(async () => {
  hub = await startInProcessHub();
}, 120_000);

afterAll(() => hub?.close());

// A failed record of the server plugin's check, as the hub stores one.
async function failed(
  seeded: Awaited<ReturnType<typeof hub.seedProject>>,
  action: string,
) {
  const id = randomUUID();
  await hub.db.execute(
    sql`insert into sb_check_run (id, tenant_id, project_id, plugin, action, input, versions, result, summary, evidence, triggered_by) values (${id}, ${seeded.person.tenantId}, ${seeded.projectId}, 'server', ${action}, '{}'::jsonb, '{}'::jsonb, 'fail', 'It did not pass', '[]'::jsonb, 'hub')`,
  );
  return id;
}

const outcome = (call: Promise<unknown>) =>
  call.then(
    () => "answered",
    (error: unknown) => String(error),
  );

test("a check its plugin says may never be skipped stays failed when the person tries, and another is skipped", async () => {
  const seeded = await hub.seedProject("Published");
  const removable = await failed(seeded, "removable");
  expect(
    await outcome(
      hub.call("POST", `${seeded.path}/checks/${removable}/skip`, {}),
    ),
  ).toContain('HTTP 409: {"code":"check_not_skippable"');
  const skipped = (await hub.db.execute(
    sql`select id from sb_check_run where project_id = ${seeded.projectId} and result = 'skipped'`,
  )) as unknown as unknown[];
  expect(skipped).toEqual([]);

  const ready = await failed(seeded, "ready");
  expect(
    await hub.json(hub.call("POST", `${seeded.path}/checks/${ready}/skip`, {})),
  ).toMatchObject({ plugin: "server", action: "ready", result: "skipped" });
}, 60_000);
