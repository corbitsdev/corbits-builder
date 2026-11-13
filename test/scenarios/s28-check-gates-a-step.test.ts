import { expect } from "bun:test";
import { type } from "arktype";
import { eq } from "drizzle-orm";
import { createEnvKeyCredentialCipher } from "@intx/crypto";
import { createRunTokenStore } from "@intx/db";
import { workflowRun } from "@intx/db/schema";
import { hexDecode } from "@intx/types";
import {
  AppBundle,
  ArtifactContent,
  CheckList,
  CheckRan,
  CheckRecord,
} from "@corbits-builder/schemas/artifact";
import { CREDENTIAL_KEY } from "../e2e/support/hub.ts";
import { NonEmptyString } from "../e2e/support/pipeline-driver.ts";
import {
  call,
  calls,
  execute,
  ok,
  refused,
  results,
  say,
  scenario,
  turn,
  user,
  type Person,
} from "./runner.ts";

const Manifest = type({
  "devDependencies?": { "[string]": "string" },
  "[string]": "unknown",
});

const WRANGLER = [
  'name = "animated-weather"',
  'main = "src/index.ts"',
  'compatibility_date = "2026-11-01"',
  'route = { pattern = "weather.example.com/*", zone_name = "example.com" }',
  "",
].join("\n");

// The person saves a version of the app with these files changed, as an import of it.
async function saveApp(
  p: Person,
  change: (files: Record<string, string>) => void,
) {
  const read = await p.call("GET", `${p.path}/artifacts/app`);
  const { files } = AppBundle.assert(
    JSON.parse(ArtifactContent.assert(read.body).content),
  );
  change(files);
  const saved = await p.call("POST", `${p.path}/artifacts`, {
    kind: "app",
    title: "Animated Weather App",
    content: JSON.stringify({ files }),
  });
  expect(saved.status).toBe(200);
}

const latestReady = async (p: Person) => {
  const listed = await p.call("GET", `${p.path}/checks`);
  const ready = CheckList.assert(listed.body).checks.find(
    (check) => check.plugin === "cloudflare" && check.action === "ready",
  );
  if (!ready) throw new Error("cloudflare ready has no record");
  return ready;
};

scenario({
  name: "s28-check-gates-a-step",
  title:
    "a check gates a step: cloudflare ready fails, passes after the config is saved, stands through a version that changes nothing it read, and the person skips it",
  start: "weather-app",
  coordinator: [
    turn(
      user("The cloudflare ready check failed."),
      say("I see your check failed."),
    ),
    turn(
      user("ready for Cloudflare"),
      calls(
        execute("c_ready", "cloudflare", "ready", {}),
        execute("c_routes", "cloudflare", "routes", {}),
        call("d_before", "discover", { group: "deploy" }),
      ),
    ),
    turn(
      results(
        ok("c_ready", "execute", '"result":"fail"'),
        refused("c_routes", "execute", "(cloudflare ready makes this true)"),
        ok("d_before", "discover"),
      ),
      say("Not ready for Cloudflare yet."),
    ),
    // Saving the config makes ready stale, and the hub re-runs it by itself.
    turn(
      user("The cloudflare ready check passed."),
      say("Your ready check passes now."),
    ),
    turn(
      user("added the wrangler config"),
      execute("c_ready_2", "cloudflare", "ready", {}),
    ),
    turn(
      results(ok("c_ready_2", "execute", '"result":"pass"')),
      execute("c_routes_2", "cloudflare", "routes", {}),
    ),
    turn(
      results(ok("c_routes_2", "execute", '"result":"pass"')),
      call("d_after", "discover", { group: "deploy" }),
    ),
    turn(results(ok("d_after", "discover")), say("Ready for Cloudflare.")),
    turn(
      user("changed the readme"),
      execute("c_routes_3", "cloudflare", "routes", {}),
    ),
    turn(
      results(ok("c_routes_3", "execute", '"result":"pass"')),
      say("The readme change leaves ready standing."),
    ),
    turn(
      user("The person skipped the cloudflare ready check."),
      execute("c_routes_4", "cloudflare", "routes", {}),
    ),
    turn(
      results(ok("c_routes_4", "execute", '"result":"pass"')),
      say("Routes pass after your skip."),
    ),
  ],
  person: async (p) => {
    await p.heard("The project is imported.");
    const first = await p.call("POST", `${p.path}/checks`, {
      plugin: "cloudflare",
      action: "ready",
    });
    p.note("the person runs cloudflare ready", first.body);
    expect(CheckRan.assert(first.body)).toMatchObject({ result: "fail" });
    await p.heard("I see your check failed.");

    await p.say("Is the app ready for Cloudflare?");
    await p.heard("Not ready for Cloudflare yet.");
    p.note("execute cloudflare ready", p.resultOf("c_ready").text);
    p.note("execute cloudflare routes", p.resultOf("c_routes").text);
    p.note("discover deploy", p.resultOf("d_before").text);

    await saveApp(p, (files) => {
      files["wrangler.toml"] = WRANGLER;
      files["src/index.ts"] =
        "export default { fetch: () => new Response('weather') };\n";
      const manifest = Manifest.assert(
        JSON.parse(files["package.json"] ?? "{}"),
      );
      const devDependencies = manifest.devDependencies ?? {};
      devDependencies["wrangler"] = "4.0.0";
      manifest.devDependencies = devDependencies;
      files["package.json"] = JSON.stringify(manifest, null, 2);
    });
    await p.heard("Your ready check passes now.");
    await p.say("I added the wrangler config.");
    await p.heard("Ready for Cloudflare.");
    p.note(
      "execute cloudflare ready after the config",
      p.resultOf("c_ready_2").text,
    );
    p.note("execute cloudflare routes", p.resultOf("c_routes_2").text);
    p.note("discover deploy", p.resultOf("d_after").text);
    const passed = await latestReady(p);
    p.note("cloudflare ready's record", passed);
    expect(passed).toMatchObject({ result: "pass", current: true });

    await saveApp(p, (files) => {
      files["README.md"] = "# Animated Weather\n";
    });
    const standing = await latestReady(p);
    p.note("cloudflare ready's record after the next version", standing);
    expect(standing).toMatchObject({
      checkId: passed.checkId,
      result: "pass",
      current: true,
    });
    await p.say("I changed the readme.");
    await p.heard("The readme change leaves ready standing.");

    const skipped = await p.call(
      "POST",
      `${p.path}/checks/${standing.checkId}/skip`,
    );
    p.note("the person skips cloudflare ready", skipped.body);
    expect(CheckRecord.assert(skipped.body)).toMatchObject({
      result: "skipped",
      current: true,
    });
    await p.heard("Routes pass after your skip.");

    // The coordinator's own run token reads the checks but cannot run or skip one as the person.
    const [run] = await p.hub.db
      .select({ principalId: workflowRun.principalId })
      .from(workflowRun)
      .where(eq(workflowRun.id, p.coordinatorRunId));
    const tokens = createRunTokenStore({
      db: p.hub.db,
      cipher: createEnvKeyCredentialCipher(hexDecode(CREDENTIAL_KEY)),
    });
    const [delivery] = await tokens.loadDelivery(
      NonEmptyString.assert(run?.principalId),
    );
    if (delivery === undefined)
      throw new Error("The coordinator run holds no run token");
    const bearer = {
      authorization: `Bearer ${delivery.token}`,
      "content-type": "application/json",
    };
    const read = await p.call("GET", `${p.path}/checks`, undefined, bearer);
    expect(read.status).toBe(200);
    const asPerson = await p.call(
      "POST",
      `${p.path}/checks`,
      { plugin: "cloudflare", action: "ready" },
      bearer,
    );
    expect(asPerson.status).toBeGreaterThanOrEqual(400);
    p.note("every message the coordinator received", p.messages("coordinator"));
  },
});
