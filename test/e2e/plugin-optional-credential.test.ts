import { afterAll, expect, test } from "bun:test";
import { cp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { workflowRun } from "@intx/db/schema";
import { CredentialResponse, ProviderResponse } from "@intx/types";
import type { ScriptedProject } from "./support/scripted-project.ts";

const KEY = "e2e-only-keeper-key-0123456789";
const INSTRUCTION =
  "Publish the project's saved app to Keeper for the person and report which way it went.";
const REPORT = "Keeper has the app.";
const AGAIN = "Publish it to Keeper now.";
// The keep link the person's earlier publish left, and the one a model tries to save in its place.
const EARLIER = "https://keeper.example/keep/earlier-keep-token";
const FROM_MODEL = "https://keeper.example/keep/from-the-model";
// The name the form saves the provider and the key under, beside the handle the tool declares.
const NAME = "plugin.keeper-api";

// The Keeper API the fixture's tool calls with the saved key, keeping the authorization it gets.
const sent: (string | null)[] = [];
const upstream = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: (request) => {
    sent.push(request.headers.get("authorization"));
    return new Response("published");
  },
});
const ORIGIN = `http://127.0.0.1:${String(upstream.port)}`;

// The hub reads its plugins once, from the repository's plugins folder, when it loads. The fixture
// is copied there, declaring this file's upstream as its origin, and resolves its imports through
// the hub's own dependencies.
const ROOT = join(import.meta.dir, "../..");
const FIXTURE = join(ROOT, "apps/hub/src/plugins/fixtures/keeper");
const INSTALLED = join(ROOT, "plugins", "keeper");
await rm(INSTALLED, { recursive: true, force: true });
await cp(FIXTURE, INSTALLED, { recursive: true });
await symlink(
  join(ROOT, "apps/hub/node_modules"),
  join(INSTALLED, "node_modules"),
);
const manifest = await Bun.file(join(INSTALLED, "package.json")).json();
manifest.builder.credentials["keeper-api"].origin = ORIGIN;
await writeFile(join(INSTALLED, "package.json"), JSON.stringify(manifest));
const { KEEP_LINK } = await import(join(FIXTURE, "src/tools.ts"));
const { call, execute, ok, openProject, refused, results, say, turn, user } =
  await import("./support/scripted-project.ts");

afterAll(async () => {
  await upstream.stop(true);
  await rm(INSTALLED, { recursive: true, force: true });
});

const TOOLS = ["keeper_publish", "report_values"];

// The coordinator waits to be told, so the test sets the project up first, then starts the publish.
const coordinator = {
  role: "coordinator" as const,
  turns: [
    turn(user("Keeper"), say("Tell me when to publish.")),
    turn(
      user(AGAIN),
      execute("c_pub", "keeper", "publish", { instruction: INSTRUCTION }),
    ),
    turn(results(ok("c_pub", "execute")), say("Publishing now.")),
    turn(user(REPORT), say("Published.")),
  ],
};

// What the person's Settings form saves: the provider in the workspace, the key in the project.
const saveKey = async ({ hub, tenantId, call }: ScriptedProject) => {
  const provider = ProviderResponse.assert(
    (
      await call("POST", `/api/tenants/${hub.workspaceTenantId}/providers`, {
        name: NAME,
        plugin: "http",
        apiBaseUrl: ORIGIN,
      })
    ).body,
  );
  CredentialResponse.assert(
    (
      await call("POST", `/api/tenants/${tenantId}/credentials`, {
        providerId: provider.id,
        name: NAME,
        type: "api_key",
        secret: KEY,
      })
    ).body,
  );
};

// The person's own save of the keep link, as the interface saves a value.
const kept = async ({ call, path }: ScriptedProject) =>
  expect(
    (
      await call("POST", `${path}/values`, {
        values: { "keeper.keep": { link: EARLIER } },
      })
    ).status,
  ).toBe(200);

// Every turn of every run in the project, as one text.
async function everyTurn(project: ScriptedProject) {
  const runs = await project.hub.db
    .select({ id: workflowRun.id })
    .from(workflowRun)
    .where(eq(workflowRun.tenantId, project.tenantId));
  const turns = await Promise.all(
    runs.map(
      async ({ id }) =>
        (
          await project.call(
            "GET",
            `/api/tenants/${project.tenantId}/workflows/runs/${id}/turns`,
          )
        ).body,
    ),
  );
  return JSON.stringify(turns);
}

test("with no key saved and the keep link set, the publish starts, its tool finds the key missing and saves the link itself, and a model can neither read nor save the link", async () => {
  const project = await openProject({
    start: { idea: "Publish my app to Keeper.", title: "Keeper" },
    runs: {
      coordinator,
      keeper: {
        role: "writer",
        turns: [
          turn(
            user("Keeper"),
            call("p_report", "report_values", {
              values: [{ name: "keeper.keep", value: { link: FROM_MODEL } }],
            }),
            TOOLS,
          ),
          turn(
            results(refused("p_report", "report_values", "private_value")),
            call("p_pub", "keeper_publish", {}),
            TOOLS,
          ),
          turn(results(ok("p_pub", "keeper_publish")), say(REPORT), TOOLS),
        ],
      },
    },
  });
  try {
    await project.heard("Tell me when to publish.");
    await kept(project);
    await project.say(AGAIN);
    await project.heard("Published.");

    expect(JSON.parse(project.resultOf("p_pub").text)).toEqual({
      keyed: false,
    });
    expect(sent).toEqual([]);
    expect(await project.values(["keeper.keep"])).toEqual({
      "keeper.keep": { link: KEEP_LINK },
    });
    expect(project.messages("keeper").join("\n")).not.toContain(EARLIER);
    const turns = await everyTurn(project);
    expect(turns).not.toContain(EARLIER);
    expect(turns).not.toContain(KEEP_LINK);
    await project.finish();
  } finally {
    await project.close();
  }
}, 600_000);

test("with the key saved, the same tool resolves it and calls the API with it", async () => {
  const project = await openProject({
    start: { idea: "Publish my app to Keeper.", title: "Keeper" },
    runs: {
      coordinator,
      keeper: {
        role: "writer",
        turns: [
          turn(user("Keeper"), call("p_pub", "keeper_publish", {}), TOOLS),
          turn(results(ok("p_pub", "keeper_publish")), say(REPORT), TOOLS),
        ],
      },
    },
  });
  try {
    await project.heard("Tell me when to publish.");
    await saveKey(project);
    await kept(project);
    await project.say(AGAIN);
    await project.heard("Published.");

    expect(JSON.parse(project.resultOf("p_pub").text)).toEqual({
      keyed: true,
      status: 200,
    });
    expect(sent).toEqual([`Bearer ${KEY}`]);
    expect(await everyTurn(project)).not.toContain(KEY);
    await project.finish();
  } finally {
    await project.close();
  }
}, 600_000);
