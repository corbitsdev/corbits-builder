import { afterAll, expect, test } from "bun:test";
import { cp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { workflowRun } from "@intx/db/schema";
import { CredentialResponse, ProviderResponse } from "@intx/types";

const KEY = "e2e-only-keyholder-key-0123456789";
const ANSWERED = "Keyholder checked the request.";
const INSTRUCTION =
  "Check the Keyholder API with the saved key and report what it answered.";
const REPORT = "The Keyholder API answered the check.";
// The name the form saves the provider and the key under, beside the handle the tool declares.
const NAME = "plugin.keyholder-api";

// The Keyholder API the fixture's tool calls, keeping the key header of every request it gets.
const sent: (string | null)[] = [];
const upstream = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    sent.push(request.headers.get("x-api-key"));
    return new Response(ANSWERED);
  },
});
const ORIGIN = `http://127.0.0.1:${String(upstream.port)}`;

// The hub reads its plugins once, from the repository's plugins folder, when it loads. The fixture
// is copied there, declaring this file's upstream as its origin, and resolves its imports through
// the hub's own dependencies.
const ROOT = join(import.meta.dir, "../..");
const INSTALLED = join(ROOT, "plugins", "keyholder");
await rm(INSTALLED, { recursive: true, force: true });
await cp(join(ROOT, "apps/hub/src/plugins/fixtures/keyholder"), INSTALLED, {
  recursive: true,
});
await symlink(
  join(ROOT, "apps/hub/node_modules"),
  join(INSTALLED, "node_modules"),
);
const manifest = await Bun.file(join(INSTALLED, "package.json")).json();
manifest.builder.credentials["keyholder-api"].origin = ORIGIN;
await writeFile(join(INSTALLED, "package.json"), JSON.stringify(manifest));
const { call, execute, ok, openProject, results, say, turn, user } =
  await import("./support/scripted-project.ts");

afterAll(async () => {
  await upstream.stop(true);
  await rm(INSTALLED, { recursive: true, force: true });
});

test("an action whose plugin's key is missing opens the plugin's form, and once the person saves the key its tool reaches the API with it while no turn holds it", async () => {
  const project = await openProject({
    start: { idea: "Check my Keyholder API key.", title: "Keyholder" },
    runs: {
      coordinator: {
        role: "coordinator",
        turns: [
          turn(
            user("Keyholder API key"),
            execute("c_key", "keyholder", "use-key", {
              instruction: INSTRUCTION,
            }),
          ),
          turn(
            results(ok("c_key", "execute")),
            say("The key checker is on it."),
          ),
          turn(user(REPORT), say("Your key works.")),
        ],
      },
      // The fixture's role is offered write_artifact, so the scripted model knows its run as a
      // writer's.
      keyholder: {
        role: "writer",
        turns: [
          turn(user("Keyholder API"), call("k_check", "check_keyholder", {}), [
            "check_keyholder",
          ]),
          turn(
            results(ok("k_check", "check_keyholder", ANSWERED)),
            say(REPORT),
            ["check_keyholder"],
          ),
        ],
      },
    },
  });
  try {
    const { hub, tenantId, projectId } = project;
    const form = await project.question();
    expect(form.asked).toEqual({
      plugin: "keyholder",
      action: "key-form",
      input: {},
    });
    expect(project.asked("keyholder")).toBe(0);

    // What the form sends with the person's session: the provider in the workspace, the key in
    // the project.
    const credentials = `/api/tenants/${tenantId}/credentials`;
    expect(
      (await project.call("GET", `${credentials}/resolve/${NAME}`)).status,
    ).toBe(404);
    const provider = ProviderResponse.assert(
      (
        await project.call(
          "POST",
          `/api/tenants/${hub.workspaceTenantId}/providers`,
          { name: NAME, plugin: "http-header", apiBaseUrl: ORIGIN },
        )
      ).body,
    );
    const saved = CredentialResponse.assert(
      (
        await project.call("POST", credentials, {
          providerId: provider.id,
          name: NAME,
          type: "api_key",
          secret: JSON.stringify({
            header: "x-api-key",
            prefix: "Token",
            value: KEY,
          }),
        })
      ).body,
    );
    expect(saved.tenantId).toBe(tenantId);

    expect(
      (await project.answer(form.signalName, { output: { saved: true } }))
        .status,
    ).toBe(200);
    await project.heard("Your key works.");
    expect(sent).toEqual([`Token ${KEY}`]);
    expect(JSON.parse(project.resultOf("k_check").text)).toEqual({
      status: 200,
      body: ANSWERED,
    });

    const runs = await hub.db
      .select({ id: workflowRun.id })
      .from(workflowRun)
      .where(eq(workflowRun.tenantId, tenantId));
    expect(runs.length).toBeGreaterThan(1);
    for (const { id } of runs) {
      const turns = await project.call(
        "GET",
        `/api/tenants/${tenantId}/workflows/runs/${id}/turns`,
      );
      expect(turns.status).toBe(200);
      expect(JSON.stringify(turns.body)).not.toContain(KEY);
    }
    expect(
      JSON.stringify(await hub.client.conversationEvents(tenantId, projectId)),
    ).not.toContain(KEY);
    await project.finish();
  } finally {
    await project.close();
  }
}, 600_000);
