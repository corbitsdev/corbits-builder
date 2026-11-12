import { expect } from "bun:test";
import { type } from "arktype";
import {
  AppBundle,
  ArtifactContent,
  CheckList,
} from "@corbits-builder/schemas/artifact";
import {
  bound,
  call,
  execute,
  keep,
  ok,
  results,
  say,
  scenario,
  startedRun,
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

// Interchange's committed log of one run, as its events route answers.
const RunEvents = type({
  events: type({
    type: "string",
    body: { "stepId?": "string", "output?": { ref: "string" } },
  }).array(),
});

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

// The steps of a publish run that ran rather than being skipped by a gate, in the order they ended.
async function stepsRan(p: Person, runId: string) {
  const read = await p.call(
    "GET",
    `/api/tenants/${encodeURIComponent(p.tenantId)}/workflows/runs/${encodeURIComponent(runId)}/events`,
  );
  expect(read.status).toBe(200);
  const { events } = RunEvents.assert(read.body);
  p.note(`run ${runId}'s events`, events);
  return events.flatMap(({ type: kind, body }) =>
    kind === "StepCompleted" &&
    body.stepId !== undefined &&
    !body.output?.ref.includes('"skipped":true')
      ? [body.stepId]
      : [],
  );
}

scenario({
  name: "s33-publish-workflow",
  title:
    "cloudflare publish runs ready then routes as an Interchange workflow with no agent: it ends at ready on a project without the config, and runs both checks once the config is saved",
  start: "weather-app",
  expectFailure:
    'cloudflare\'s publish workflow is not wired in yet: execute refuses with cloudflare has no action "publish".',
  coordinator: [
    turn(
      user("Publish the app to Cloudflare"),
      execute("c_publish", "cloudflare", "publish", {}),
    ),
    turn(
      results(keep(ok("c_publish", "execute"), { first: "runs.0.runId" })),
      call("c_wait", "runs", {
        operation: "wait",
        runIds: [bound("first")],
        seconds: 60,
      }),
    ),
    turn(
      results(ok("c_wait", "runs", '"completed"')),
      call("c_list", "runs", { operation: "list" }),
    ),
    turn(
      results(ok("c_list", "runs", '"action":"publish"')),
      say("Not ready for Cloudflare yet."),
    ),
    turn(
      user("added the wrangler config"),
      execute("c_publish_2", "cloudflare", "publish", {}),
    ),
    turn(
      results(keep(ok("c_publish_2", "execute"), { second: "runs.0.runId" })),
      call("c_wait_2", "runs", {
        operation: "wait",
        runIds: [bound("second")],
        seconds: 60,
      }),
    ),
    turn(
      results(ok("c_wait_2", "runs", '"completed"')),
      say("Published checks pass."),
    ),
  ],
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.say("Publish the app to Cloudflare.");
    await p.heard("Not ready for Cloudflare yet.");
    const first = startedRun(p.resultOf("c_publish").text);
    p.note("runs list", p.resultOf("c_list").text);
    expect(await stepsRan(p, first)).toEqual([
      "ready",
      "readyPassed",
      "notReady",
    ]);

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
    await p.say("I added the wrangler config.");
    await p.heard("Published checks pass.");
    const second = startedRun(p.resultOf("c_publish_2").text);
    expect(await stepsRan(p, second)).toEqual([
      "ready",
      "readyPassed",
      "routes",
      "routesPassed",
      "published",
    ]);

    // The checks the workflow ran are the hub's own records.
    const listed = await p.call("GET", `${p.path}/checks`);
    const records = CheckList.assert(listed.body).checks.filter(
      (check) => check.plugin === "cloudflare",
    );
    p.note("cloudflare check records", records);
    expect(records.map(({ action, result }) => [action, result])).toEqual(
      expect.arrayContaining([
        ["ready", "pass"],
        ["routes", "pass"],
      ]),
    );
    p.note("every message the coordinator received", p.messages("coordinator"));
  },
});
