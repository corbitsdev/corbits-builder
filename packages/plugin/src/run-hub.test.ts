import { expect, test } from "bun:test";
import { zip } from "@corbits/zip";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { APP_VERSION_HEADER } from "@corbits-builder/schemas/app-files";
import {
  BuilderUnavailable,
  cappedBytes,
  hubZipFiles,
  runHub,
  type Clock,
} from "./run-hub.ts";

const SCOPE = {
  tenantId: "tenant-1",
  projectId: "00000000-0000-4000-8000-000000000001",
  domain: "example.invalid",
  role: "publisher",
  workflows: {
    publisher: {
      source: {
        kind: "asset" as const,
        assetId: "asset",
        package: { format: "tarball" as const },
      },
      entry: "entry",
      pin: "@corbits-builder/publisher@1.0.0",
      sourceOfferingIds: ["offering"],
      defaultSourceOfferingId: "offering",
    },
  },
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
const PROJECT = `/api/tenants/${SCOPE.tenantId}/projects/${SCOPE.projectId}`;

// A run's hub client whose hub answers each project route through answer, and the paths it asked.
function hubFor(
  answer: (route: string) => Response | Promise<Response>,
  run: { signal?: AbortSignal; clock?: Clock } = {},
) {
  const asked: string[] = [];
  const methods: string[] = [];
  const capabilities = {
    resolve: () => ({
      resolve: async (handle: string) => {
        if (handle !== HUB_CREDENTIAL_HANDLE)
          throw new Error(`no credential ${handle}`);
        return {
          kind: "http",
          fetch: async (path: string, init?: RequestInit) => {
            if (path === "/api/workflow-project-scope")
              return Response.json(SCOPE);
            const route = path.slice(PROJECT.length);
            asked.push(route);
            methods.push(init?.method ?? "GET");
            return answer(route);
          },
          dispose() {},
        };
      },
    }),
  } as unknown as RuntimeCapabilities;
  return {
    hub: runHub(
      capabilities,
      SCOPE.role,
      run.signal ?? new AbortController().signal,
      run.clock,
    ),
    asked,
    methods,
  };
}

const text = (files: ReadonlyMap<string, Uint8Array>) =>
  Object.fromEntries(
    [...files].map(([path, data]) => [path, new TextDecoder().decode(data)]),
  );

const versioned = async (files: { path: string; data: string }[]) =>
  new Response(await zip(files), { headers: { [APP_VERSION_HEADER]: "v3" } });

test("the saved app's files come without the folder the hub's zip puts them under, with the version they hold", async () => {
  const { hub } = hubFor(() =>
    versioned([
      { path: "Shop/package.json", data: "{}" },
      { path: "Shop/server/index.ts", data: "export {}" },
    ]),
  );
  const source = await hub.source();
  expect(source?.version).toBe("v3");
  expect(text(source?.files ?? new Map())).toEqual({
    "package.json": "{}",
    "server/index.ts": "export {}",
  });
});

test("a project with no saved app has no source", async () => {
  const { hub } = hubFor(() =>
    Response.json({ code: "app_not_filed" }, { status: 404 }),
  );
  expect(await hub.source()).toBeUndefined();
});

test("a build hands back its paths as built, or only the hub's code for refusing it", async () => {
  const built = hubFor(() =>
    versioned([{ path: "client/dist/index.html", data: "<p>" }]),
  );
  const answer = await built.hub.build(["client/dist", "server/dist/w.js"]);
  expect(built.asked).toEqual([
    "/app/build-archive?path=client%2Fdist&path=server%2Fdist%2Fw.js",
  ]);
  expect("files" in answer && text(answer.files)).toEqual({
    "client/dist/index.html": "<p>",
  });

  const refused = hubFor(() =>
    Response.json(
      { code: "build_failed", hint: "npm ERR! what the build printed" },
      { status: 422 },
    ),
  );
  expect(await refused.hub.build(["dist"])).toEqual({
    refused: "build_failed",
  });
});

const busy = () =>
  Response.json({ code: "app_command_running" }, { status: 409 });

// A clock that moves only when slept on, and how long was slept in all.
function fakeClock() {
  let now = 0;
  return {
    clock: {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    },
    sleptMs: () => now,
  };
}

test("a build refused while the project's checks run is asked again until it builds", async () => {
  let refusals = 3;
  const { clock, sleptMs } = fakeClock();
  const { hub, asked } = hubFor(
    () =>
      refusals-- > 0
        ? busy()
        : versioned([{ path: "dist/index.html", data: "<p>" }]),
    { clock },
  );
  const answer = await hub.build(["dist"]);
  expect("files" in answer && text(answer.files)).toEqual({
    "dist/index.html": "<p>",
  });
  expect(asked).toHaveLength(4);
  expect(sleptMs()).toBeLessThan(60_000);
});

test("a build still refused as busy once the wait is over is the hub's refusal", async () => {
  const { clock, sleptMs } = fakeClock();
  const { hub, asked } = hubFor(busy, { clock });
  expect(await hub.build(["dist"])).toEqual({
    refused: "app_command_running",
  });
  // Long enough to outlast the checks a save sets off, short enough to leave the publish its time.
  expect(sleptMs()).toBeGreaterThanOrEqual(60_000);
  expect(sleptMs()).toBeLessThan(3 * 60_000);
  expect(asked.length).toBeGreaterThan(2);
});

test("a run cancelled while a build waits for the checks stops at once without asking again", async () => {
  const run = new AbortController();
  const waiting = Promise.withResolvers<void>();
  const { hub, asked } = hubFor(busy, {
    signal: run.signal,
    // A sleep that never ends on its own, so only the cancel can end the wait.
    clock: {
      now: () => 0,
      sleep: () => {
        waiting.resolve();
        return new Promise(() => {});
      },
    },
  });
  const building = hub.build(["dist"]);
  await waiting.promise;
  run.abort();
  await expect(building).rejects.toBe(run.signal.reason);
  expect(asked).toHaveLength(1);
});

test("whatever goes wrong reaching the hub is BuilderUnavailable, carrying none of the hub's words", async () => {
  const answers = [
    () => Response.json({ code: "unauthorized" }, { status: 401 }),
    () => new Response("proxy error page", { status: 502 }),
    () => Response.json({ code: "something_new" }, { status: 422 }),
    () => {
      throw new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:8000");
    },
    // A download the hub forgot to name the version of.
    async () => new Response(await zip([{ path: "Shop/a", data: "a" }])),
  ];
  // Every call, whichever of these answers the hub gives it.
  for (const answer of answers) {
    const { hub } = hubFor(answer);
    for (const call of [
      () => hub.values(["stack.production"]),
      () => hub.record({ "publish.release": null }),
      () => hub.source(),
      () => hub.build(["dist"]),
    ]) {
      const error = await call().then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(BuilderUnavailable);
      expect(String(error)).toBe("BuilderUnavailable: builder_unavailable");
    }
  }
});

// A zip whose entry named path is recorded, as a Unix zip tool records it, as a symbolic link.
async function withLink(path: string) {
  const bytes = await zip([{ path, data: "/etc" }]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let at = 0; at + 4 <= bytes.length; at++)
    if (view.getUint32(at, true) === 0x02014b50) {
      view.setUint8(at + 5, 3);
      view.setUint32(at + 38, (0o120777 << 16) >>> 0, true);
    }
  return bytes;
}

// A zip of the given files with each name's bytes replaced, keeping its length, for names the zip
// writer itself refuses to write.
async function renamed(path: string, from: string, to: string) {
  const bytes = await zip([{ path, data: "x" }]);
  const latin = Buffer.from(bytes).toString("latin1").replaceAll(from, to);
  return new Uint8Array(Buffer.from(latin, "latin1"));
}

test("a zip holding a link, or a path that leaves the app or reads two ways, never reaches a publish", async () => {
  for (const hostile of [
    await withLink("Shop/server"),
    await renamed("Shop/xx/passwd", "xx", ".."),
    await renamed("Shop/etc/passwd", "Shop/etc", "/Shop/et"),
    await renamed("Shop/X/etc/passwd", "Shop/X/", "Shop//X"),
    await renamed("Shop/X/etc/passwd", "Shop/X/", "Shop/./"),
  ])
    await expect(hubZipFiles(hostile, true)).rejects.toBeInstanceOf(
      BuilderUnavailable,
    );
});

// A body that streams chunks of a size until it has sent the total, counting what was read.
function streamed(chunk: number, total: number) {
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= total) return controller.close();
      sent += chunk;
      controller.enqueue(new Uint8Array(chunk));
    },
  });
  return { response: new Response(body), sent: () => sent };
}

test("a body is refused as soon as it streams past its cap, without reading the rest", async () => {
  const within = streamed(1024, 4096);
  expect((await cappedBytes(within.response, 4096)).length).toBe(4096);

  const over = streamed(1024, 1024 * 1024);
  await expect(cappedBytes(over.response, 4096)).rejects.toThrow(
    "download_too_large",
  );
  expect(over.sent()).toBeLessThan(16 * 1024);

  const declared = new Response("x".repeat(10), {
    headers: { "content-length": "10" },
  });
  await expect(cappedBytes(declared, 4)).rejects.toThrow("download_too_large");
});

const ISSUED = {
  publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA builder-abcdefghijkl",
  label: "builder-abcdefghijkl",
  state: "issued" as const,
};

test("a server key comes back as the hub answered it, and a server key refusal as its code alone", async () => {
  const issued = hubFor(() => Response.json(ISSUED));
  expect(await issued.hub.serverKey("hoster-server")).toEqual(ISSUED);
  expect(issued.asked).toEqual(["/run-credentials/hoster-server/key"]);

  const starting = hubFor(() =>
    Response.json({ code: "server_unreachable" }, { status: 502 }),
  );
  expect(
    await starting.hub.bindServerKey("hoster-server", {
      host: "203.0.113.7",
      hostKey: `SHA256:${"a".repeat(43)}`,
    }),
  ).toEqual({ refused: "server_unreachable" });
  expect(starting.asked).toEqual(["/run-credentials/hoster-server/bind"]);
});

test("a server key call the hub refuses for any other reason is BuilderUnavailable", async () => {
  const { hub } = hubFor(() =>
    Response.json(
      { code: "run_credential_not_provisioned", hint: "not this run's" },
      { status: 403 },
    ),
  );
  await expect(hub.serverKey("hoster-server")).rejects.toBeInstanceOf(
    BuilderUnavailable,
  );
  await expect(hub.revokeServerKey("hoster-server")).rejects.toBeInstanceOf(
    BuilderUnavailable,
  );
});

test("reading a server key asks without making one, and a key never asked for reads as none", async () => {
  const held = hubFor(() => Response.json(ISSUED));
  expect(await held.hub.heldServerKey("hoster-server")).toEqual(ISSUED);
  expect(held.asked).toEqual(["/run-credentials/hoster-server/key"]);
  expect(held.methods).toEqual(["GET"]);

  const none = hubFor(() =>
    Response.json({ code: "server_key_not_issued" }, { status: 404 }),
  );
  expect(await none.hub.heldServerKey("hoster-server")).toBeUndefined();
});
