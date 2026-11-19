import { expect, test } from "bun:test";
import { zip } from "@corbits/zip";
import { UnboundCredentialError } from "@intx/types";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { APP_VERSION_HEADER } from "@corbits-builder/schemas/app-files";
import removeTools from "./remove-tools.ts";
import tools from "./tools.ts";

const deployment = {
  source: {
    kind: "asset" as const,
    assetId: "asset",
    package: { format: "tarball" as const },
  },
  entry: "entry",
  pin: "@corbits-builder/cloudflare@1.0.0",
  sourceOfferingIds: ["offering"],
  defaultSourceOfferingId: "offering",
};
const SCOPE = {
  tenantId: "tenant-1",
  projectId: "00000000-0000-4000-8000-000000000001",
  domain: "example.invalid",
  role: "cloudflare",
  workflows: { cloudflare: deployment },
  openNetwork: false,
  toolchains: { paths: [], dataDir: "/unused" },
  firstBuild: false,
  build: {
    assetDirectory: "/tmp",
    browserCli: "/tmp/browser",
    childPath: "/tmp/child",
    dependencyRoots: ["/tmp"],
    ripgrepPath: "/tmp/rg",
    runtimeVersion: "1.0.0",
  },
};
const PRODUCTION = {
  install: "bun install --frozen-lockfile",
  build: "bun run build",
  start: "bun run start",
  port: "PORT",
  data: [],
};
const WRANGLER = JSON.stringify({
  name: "app",
  main: "server/dist/worker.js",
  compatibility_date: "2026-11-01",
  compatibility_flags: ["nodejs_compat"],
});

// The cloudflare tools as the agent gets them, with no Cloudflare key saved, as Interchange
// resolves a credential the run may do without, and the hub answering through hub.
async function call(
  name: string,
  hub: (path: string) => Promise<Response>,
  of = tools,
): Promise<string> {
  const capabilities = {
    resolve: () => ({
      resolve: async (handle: string) => {
        if (handle === HUB_CREDENTIAL_HANDLE)
          return { kind: "http", fetch: hub, dispose() {} };
        throw new UnboundCredentialError(
          handle,
          "tool:@corbits-builder/cloudflare",
        );
      },
    }),
  } as unknown as RuntimeCapabilities;
  const [factory] = of({ role: "cloudflare" });
  if (factory === undefined) throw new Error("no cloudflare tools");
  const result = await factory({
    capabilities,
    toolCwd: "/unused",
  } as never).run(
    { id: "call", name, arguments: {} },
    new AbortController().signal,
  );
  return String(result.content);
}

// A hub holding a saved app made to run on Workers and these values.
function project(values: Record<string, unknown>) {
  return async (path: string) => {
    if (path === "/api/workflow-project-scope") return Response.json(SCOPE);
    if (path.includes("/run-values?")) {
      const keys = new URL(path, "http://hub").searchParams.get("keys") ?? "";
      return Response.json({
        values: Object.fromEntries(
          keys.split(",").map((key) => [key, values[key] ?? null]),
        ),
      });
    }
    if (path.endsWith("/app/archive"))
      return new Response(
        await zip([{ path: "app/wrangler.jsonc", data: WRANGLER }]),
        { headers: { [APP_VERSION_HEADER]: "v1" } },
      );
    return Response.json({ code: "unexpected_route" }, { status: 404 });
  };
}

test("with no key saved and no acceptance, no account is chosen", async () => {
  const answer = await call(
    "cloudflare_release",
    project({ "stack.production": PRODUCTION }),
  );
  expect(JSON.parse(answer)).toEqual({ ok: false, code: "no_account_chosen" });
});

test("taking down an app in a temporary account is refused in the code that says why, and records nothing", async () => {
  const recorded: string[] = [];
  const hub = project({
    "cloudflare.site": {
      account: "acc-temp",
      script: "app",
      temporary: true,
    },
    "publish.release": {
      target: "cloudflare",
      url: "https://app.example.workers.dev/",
      version: "v1",
      at: "2026-11-18T10:00:00.000Z",
    },
    "publish.take-down": {
      target: "cloudflare",
      release: "2026-11-18T10:00:00.000Z",
    },
  });
  const answer = await call(
    "cloudflare_unpublish",
    async (path) => {
      if (path.endsWith("/run-values")) recorded.push(path);
      return hub(path);
    },
    removeTools,
  );
  expect(JSON.parse(answer)).toEqual({
    ok: false,
    code: "needs_own_account",
    temporary: true,
  });
  expect(recorded).toEqual([]);
});
