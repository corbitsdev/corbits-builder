import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { createArtifact } from "@corbits/artifacts";
import { toolConsumer } from "@intx/authz";
import { createNoopCredentialCipher } from "@intx/crypto";
import { createRunTokenStore } from "@intx/db";
import { grant } from "@intx/db/schema";
import type { DesignDraft } from "@corbits-builder/schemas/artifact";
import { startInProcessHub } from "./support/in-process-hub.ts";

let hub: Awaited<ReturnType<typeof startInProcessHub>>;

beforeAll(async () => {
  hub = await startInProcessHub();
});

afterAll(() => hub?.close());

// The draft a running designer run of concept Calm reads as its previous one, in a project whose
// concept option is filed with a look the person saved, and whose earlier Calm designer runs are
// given oldest first, each with the draft it left on disk, if any. An ended run ended a minute
// ago, so the option was filed after it unless it is moved further back.
async function previousDraft(
  earlier: readonly { running?: boolean; left?: string }[],
  optionMinutes = 0,
) {
  const { projectId, person, path } = await hub.seedProject("Design draft");
  const option = await hub.db.transaction((tx) =>
    createArtifact(tx, {
      scope: person,
      ownerPrincipalId: person.principalId,
      kind: "design_option",
      title: "Calm",
      content: JSON.stringify({
        files: {
          "DESIGN.md": "# Calm\n",
          "designs/index.html": "<main>Calm</main>\n",
          "designs/styles.css": ":root {\n  --primary: #111111;\n}\n",
        },
      }),
      source: { origin: "manual" },
    }),
  );
  await hub.call("POST", `${path}/design-tweaks`, {
    concept: "Calm",
    tokens: { primary: "#336699" },
  });
  await hub.db.execute(
    sql`update artifacts.artifact_version set created_at = created_at + ${optionMinutes} * interval '1 minute' where artifact_id = ${option.id}`,
  );
  const runs = [];
  for (const { running, left } of earlier) {
    const run = await hub.seedRun(person, "designer", running);
    if (left) {
      const builder = join(run.workspace, ".builder");
      await mkdir(join(builder, "designs"), { recursive: true });
      await writeFile(join(builder, "DESIGN.md"), `# ${left}\n`);
      await writeFile(
        join(builder, "designs", "index.html"),
        `<main>${left}</main>\n`,
      );
    }
    runs.push(run);
  }
  const designer = await hub.seedRun(person, "designer", true);
  for (const run of [...runs, designer])
    await hub.db.execute(
      sql`insert into sb_design_concept (run_id, tenant_id, project_id, label, direction) values (${run.id}, ${person.tenantId}, ${projectId}, 'Calm', 'Soft and quiet')`,
    );
  await hub.db.insert(grant).values({
    id: randomUUID(),
    tenantId: person.tenantId,
    principalId: designer.principalId,
    resource: `sb-project:${projectId}`,
    action: "read",
    effect: "allow",
    origin: "system",
  });
  const tokens = createRunTokenStore({
    db: hub.db,
    cipher: createNoopCredentialCipher(),
  });
  await tokens.mintIfAbsent(
    { principalId: designer.principalId, consumers: [toolConsumer("draft")] },
    hub.db,
  );
  const [delivery] = await tokens.loadDelivery(designer.principalId);
  return hub.json<DesignDraft>(
    hub.call("GET", `${path}/design-draft/previous`, undefined, {
      authorization: `Bearer ${delivery!.token}`,
    }),
  );
}

// The filed option's DESIGN.md, and whether the draft carries the look the person saved.
const optionWithSavedLook = { "DESIGN.md": "# Calm\n", saved: true };
test.each([
  {
    scenario: "the newest earlier run's draft while that run is live",
    earlier: [{ running: true, left: "Live" }],
    optionMinutes: 0,
    expected: { "DESIGN.md": "# Live\n", saved: false },
  },
  {
    scenario:
      "the newest earlier run's draft over an option filed before it ended",
    earlier: [{ left: "Closed" }],
    optionMinutes: -2,
    expected: { "DESIGN.md": "# Closed\n", saved: false },
  },
  {
    scenario: "the option filed after the newest earlier run ended",
    earlier: [{ left: "Closed" }],
    optionMinutes: 0,
    expected: optionWithSavedLook,
  },
  {
    scenario:
      "the option once the newest earlier run's workspace is gone, over an older run's draft",
    earlier: [{ left: "Stale" }, {}],
    optionMinutes: 0,
    expected: optionWithSavedLook,
  },
])(
  "a design dispatched again continues from $scenario",
  async ({ earlier, optionMinutes, expected }) => {
    const draft = await previousDraft(earlier, optionMinutes);
    expect({
      "DESIGN.md": draft.files["DESIGN.md"],
      saved: Boolean(
        draft.files["designs/styles.css"]?.includes("--primary: #336699"),
      ),
    }).toEqual(expected);
  },
);
