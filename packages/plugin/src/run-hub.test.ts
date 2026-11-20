import { expect, test } from "bun:test";
import { zip } from "@corbits/zip";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { APP_VERSION_HEADER } from "@corbits-builder/schemas/app-files";
import {
  BuilderUnavailable,
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
  clock?: Clock,
) {
  const asked: string[] = [];
  const capabilities = {
    resolve: () => ({
      resolve: async (handle: string) => {
        if (handle !== HUB_CREDENTIAL_HANDLE)
          throw new Error(`no credential ${handle}`);
        return {
          kind: "http",
          fetch: async (path: string) => {
            if (path === "/api/workflow-project-scope")
              return Response.json(SCOPE);
            const route = path.slice(PROJECT.length);
            asked.push(route);
            return answer(route);
          },
          dispose() {},
        };
      },
    }),
  } as unknown as RuntimeCapabilities;
  return {
    hub: runHub(capabilities, SCOPE.role, new AbortController().signal, clock),
    asked,
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

test("a build refused while the project's checks run is asked again until it builds, and given up on once the wait is over", async () => {
  let refusals = 3;
  const { clock, sleptMs } = fakeClock();
  const { hub, asked } = hubFor(
    () =>
      refusals-- > 0
        ? busy()
        : versioned([{ path: "dist/index.html", data: "<p>" }]),
    clock,
  );
  const answer = await hub.build(["dist"]);
  expect("files" in answer && text(answer.files)).toEqual({
    "dist/index.html": "<p>",
  });
  expect(asked).toHaveLength(4);
  expect(sleptMs()).toBeLessThan(60_000);

  const stillBusy = hubFor(busy, fakeClock().clock);
  expect(await stillBusy.hub.build(["dist"])).toEqual({
    refused: "app_command_running",
  });
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

const ISSUED = {
  publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA builder-abcdefghijkl",
  label: "builder-abcdefghijkl",
  state: "issued" as const,
};

test("a server key comes back as the hub answered it, a server key refusal as its code alone, and a key never asked for as none", async () => {
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

  const none = hubFor(() =>
    Response.json({ code: "server_key_not_issued" }, { status: 404 }),
  );
  expect(await none.hub.heldServerKey("hoster-server")).toBeUndefined();
});
