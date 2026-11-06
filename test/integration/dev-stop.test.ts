import { describe, expect, test } from "bun:test";
import {
  describeHeldPorts,
  neededPorts,
  parseDotenv,
  parseLsofListeners,
  parseSsListeners,
  type ProcessInfo,
  selectAppProcesses,
} from "../../scripts/dev-stop.ts";

// A machine running this app next to other projects' `bun run dev`, a terminal
// that names the checkout, and the shell running `bun run dev:stop` itself.
const here = "/home/dev/corbits-builder";
const elsewhere = "/home/dev/corbits-builder-worktree";
const other = "/home/dev/other-app";
const checkoutOf = (directory: string) =>
  [here, elsewhere].find(
    (root) => directory === root || directory.startsWith(`${root}/`),
  );

const bun = (
  pid: number,
  ppid: number,
  command: string,
  cwd?: string,
): ProcessInfo => ({ pid, ppid, command, cwd });
const processes: ProcessInfo[] = [
  // Another project's dev stack, with a hub-like entry point of its own.
  bun(100, 1, "bun run dev", other),
  bun(101, 100, "bun scripts/dev.ts", other),
  bun(102, 101, `bun ${other}/apps/hub/src/server.ts --open`, other),
  bun(103, 101, `node ${other}/node_modules/.bin/vite --port 5173`, other),
  // A terminal helper and an editor that merely name the checkout.
  {
    pid: 200,
    ppid: 1,
    command: `/Applications/iTerm.app/Contents/MacOS/pidinfo --git-state ${here} 4 1`,
  },
  {
    pid: 201,
    ppid: 1,
    command: `/usr/local/bin/code ${here}/apps/hub/src/server.ts`,
  },
  // This app, started by `bun run dev` in this checkout.
  bun(300, 250, "bun run dev", here),
  bun(301, 300, "bun --env-file=.env.web run --parallel dev:hub dev:web", here),
  bun(302, 301, "bun run dev:hub", here),
  bun(
    303,
    302,
    "bun --env-file=.env.hub --conditions=intx-src apps/hub/src/server.ts",
    here,
  ),
  bun(
    304,
    303,
    `bun ${here}/vendor/interchange/apps/sidecar/src/index.ts`,
    here,
  ),
  bun(
    305,
    304,
    `bun ${here}/vendor/interchange/apps/sidecar/bin/workflow-child`,
    here,
  ),
  bun(306, 301, "bun run dev:web", here),
  bun(
    307,
    306,
    `node ${here}/apps/web/node_modules/.bin/vite`,
    `${here}/apps/web`,
  ),
  bun(
    308,
    307,
    `${here}/node_modules/.bun/@esbuild+darwin-arm64@0.28.2/node_modules/@esbuild/darwin-arm64/bin/esbuild --service=0.28.2 --ping`,
    `${here}/apps/web`,
  ),
  // A live-app host and the project app under it, running from the data directory.
  bun(
    309,
    303,
    `bun ${here}/apps/hub/src/live-app/host.ts ${here}/data/hub/live-apps/p1/workspace`,
    here,
  ),
  {
    pid: 310,
    ppid: 309,
    command: "npm run dev",
    cwd: `${here}/data/hub/live-apps/p1/workspace`,
  },
  // A sidecar orphaned by an earlier hub, and a hub from another checkout started with `bun run start`.
  bun(400, 1, `bun ${here}/vendor/interchange/apps/sidecar/src/index.ts`, here),
  bun(
    401,
    1,
    "bun --env-file=.env.hub --conditions=intx-src apps/hub/src/server.ts",
    elsewhere,
  ),
  bun(
    402,
    1,
    "bun --env-file=.env.hub --conditions=intx-src apps/hub/src/migrate.ts",
    elsewhere,
  ),
  // The shell running `bun run dev:stop` and its ancestors.
  { pid: 250, ppid: 1, command: "-bash", cwd: here },
  bun(500, 250, "bun run dev:stop", here),
  bun(501, 500, "bun scripts/dev-stop.ts", here),
  // Unrelated work in this checkout.
  bun(600, 250, "bun --conditions=intx-src test ./apps/hub", here),
  bun(601, 250, "bun run dev:seed", here),
];

describe("dev:stop", () => {
  test("selects this app's processes from every checkout and nothing else", () => {
    const selected = selectAppProcesses(processes, {
      self: 501,
      checkoutOf,
    }).map((info) => info.pid);
    expect(selected.sort((a, b) => a - b)).toEqual([
      300, 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 400, 401, 402,
    ]);
  });

  test("finds nothing when the app is not running", () => {
    const idle = processes.filter((info) => info.pid < 300 || info.pid >= 500);
    expect(selectAppProcesses(idle, { self: 501, checkoutOf })).toEqual([]);
  });
});

describe("dev:stop port report", () => {
  test("resolves the ports as bun run dev does: shell, then env files, then defaults", () => {
    expect(neededPorts({}, {}, {}).map(({ port }) => port)).toEqual([
      8000, 5173,
    ]);
    expect(
      neededPorts({}, { PORT: "8877" }, { UI_PORT: "5174" }).map(
        ({ port }) => port,
      ),
    ).toEqual([8877, 5174]);
    expect(
      neededPorts(
        { PORT: "9000", UI_PORT: "5175" },
        { PORT: "8877" },
        { UI_PORT: "5174" },
      ).map(({ port }) => port),
    ).toEqual([9000, 5175]);
    expect(
      neededPorts({ PORT: "later" }, { PORT: "0" }, {}).map(({ port }) => port),
    ).toEqual([8000, 5173]);
  });

  test("reads a port from a dotenv file with comments and quotes", () => {
    expect(
      parseDotenv(
        [
          "# The hub",
          "PORT=8877 # published by compose",
          'export UI_PORT="5174"',
          "DB_URL='postgres://x:y@h/db'",
          "not a line",
        ].join("\n"),
      ),
    ).toEqual({
      PORT: "8877",
      UI_PORT: "5174",
      DB_URL: "postgres://x:y@h/db",
    });
  });

  test("parses listeners from lsof and ss", () => {
    expect(
      parseLsofListeners(
        "p41465\ncnode\nf18\nn[::1]:5173\np94796\ncssh\nf34\nn127.0.0.1:8877\n",
      ),
    ).toEqual([
      { port: 5173, pid: 41465 },
      { port: 8877, pid: 94796 },
    ]);
    expect(
      parseSsListeners(
        [
          'LISTEN 0 511 [::1]:5173 [::]:* users:(("node",pid=41465,fd=18))',
          'LISTEN 0 4096 127.0.0.1:8877 0.0.0.0:* users:(("docker-proxy",pid=94796,fd=4))',
          "",
        ].join("\n"),
      ),
    ).toEqual([
      { port: 5173, pid: 41465 },
      { port: 8877, pid: 94796 },
    ]);
  });

  test("names what holds each needed port, skipping what is being stopped", () => {
    const needed = neededPorts({}, { PORT: "8877" }, {});
    const listeners = [
      { port: 5173, pid: 41465 },
      { port: 8877, pid: 94796 },
      { port: 8877, pid: 303 },
      { port: 9999, pid: 1 },
    ];
    const commands = new Map([
      [41465, `node ${other}/node_modules/.bin/vite --port 5173`],
      [94796, "ssh: /home/dev/.colima/_lima/colima/ssh.sock [mux]"],
      [303, "bun apps/hub/src/server.ts"],
    ]);
    const lines = describeHeldPorts(
      needed,
      listeners,
      (pid) => commands.get(pid),
      new Set([303]),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("8877");
    expect(lines[0]).toContain("pid 94796");
    expect(lines[0]).toContain("docker ps");
    expect(lines[1]).toContain("5173");
    expect(lines[1]).toContain("vite --port 5173");
    expect(lines[1]).not.toContain("docker ps");
  });
});
