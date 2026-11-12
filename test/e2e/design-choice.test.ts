import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  createArtifact,
  getArtifactVersion,
  writeArtifactVersion,
  type ArtifactDb,
} from "@corbits/artifacts";
import { approval } from "@intx/db/schema";
import { startInProcessHub } from "./support/in-process-hub.ts";

let hub: Awaited<ReturnType<typeof startInProcessHub>>;

beforeAll(async () => {
  hub = await startInProcessHub();
});

afterAll(() => hub?.close());

const bundle = (look: string) =>
  JSON.stringify({ files: { "index.html": `<main>${look}</main>` } });

// A choose_design approval files one design from the concept it names, and a retry of that
// approval returns the same design instead of filing another.
test("a design choice files once, for the approved concept, tweaks included", async () => {
  const { projectId, person, path } = await hub.seedProject("Design choice");
  const coordinator = await hub.seedRun(person, "coordinator");
  await hub.db.execute(
    sql`insert into project_coordinator (run_id, project_id, registered_by) values (${coordinator.id}, ${projectId}, ${person.principalId})`,
  );
  const artifactDb = hub.db as unknown as ArtifactDb;
  const option = (concept: string) =>
    artifactDb.transaction((tx) =>
      createArtifact(tx, {
        scope: person,
        ownerPrincipalId: person.principalId,
        kind: "design_option",
        title: concept,
        content: bundle(concept),
        source: { origin: "workflow" },
      }),
    );
  const harbour = await option("Harbour");
  await option("Meadow");
  const approve = async (concept: string, runId = coordinator.id) => {
    const id = randomUUID();
    await hub.db.insert(approval).values({
      id,
      tenantId: person.tenantId,
      anchorRunId: runId,
      runId,
      agentAddress: `${runId}@${person.tenantId}.test`,
      correlationId: id,
      toolDefinition: { name: "choose_design" },
      toolArguments: { concept },
      status: "approved",
      scope: "once",
      resolvedAt: new Date(),
    });
    return id;
  };
  const choose = (concept: string) =>
    hub.call("POST", `${path}/design-choice`, { concept });
  const recorded = async (approvalId: string) =>
    (
      await hub.db.execute<{ kind: string; version: number }>(
        sql`select kind, version from sb_artifact_approval where approval_id = ${approvalId} order by kind`,
      )
    ).map(({ kind, version }) => ({ kind, version }));

  const first = await approve("Harbour");
  const chosen = await hub.json<{
    concept: string;
    design: { artifactId: string; version: number };
  }>(choose("Harbour"));
  expect(chosen.concept).toBe("Harbour");
  expect(chosen.design.version).toBe(1);
  expect(await recorded(first)).toEqual([
    { kind: "design", version: 1 },
    { kind: "design_option", version: 1 },
  ]);

  // A retry after the design was filed returns the same design, never a second one.
  const retried = await hub.json<{ design: { version: number } }>(
    choose("Harbour"),
  );
  expect(retried.design.version).toBe(1);

  // An approval of one concept never files another.
  await expect(choose("Meadow")).rejects.toThrow("HTTP 409");

  // An approval raised by a run that is not a project coordinator is never consumed.
  const designer = await hub.seedRun(person, "designer");
  const outsider = await approve("Meadow", designer.id);
  await expect(choose("Meadow")).rejects.toThrow("HTTP 409");
  expect(await recorded(outsider)).toEqual([]);

  // A look tweak saved while the card is open is part of the concept the approval covers.
  const second = await approve("Harbour");
  await writeArtifactVersion(artifactDb, {
    scope: person,
    artifactId: harbour.id,
    content: bundle("Harbour, tweaked"),
  });
  const tweaked = await hub.json<{
    design: { artifactId: string; version: number };
  }>(choose("Harbour"));
  expect(tweaked.design.version).toBe(2);
  expect(await recorded(second)).toEqual([
    { kind: "design", version: 2 },
    { kind: "design_option", version: 2 },
  ]);
  const filed = await getArtifactVersion(
    artifactDb,
    tweaked.design.artifactId,
    2,
  );
  expect(filed?.content).toBe(bundle("Harbour, tweaked"));
});

test("a design choice asks the hub for a concept, not an artifact version", async () => {
  const { path } = await hub.seedProject("Design choice shape");
  // The old body names the option it chose; the new approval covers the concept.
  await expect(
    hub.call("POST", `${path}/design-choice`, {
      artifactId: "artifact",
      version: 1,
    }),
  ).rejects.toThrow("HTTP 400");
});
