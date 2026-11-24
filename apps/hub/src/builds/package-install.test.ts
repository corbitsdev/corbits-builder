import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolCall } from "@intx/types/runtime";
import {
  PACKAGE_INSTALL_TOOL,
  PLANNED_INSTALL_TOOL,
} from "@corbits-builder/schemas/package-install";
import { preapprovedPackages } from "../artifacts/approvals.ts";
import { createPackageGate } from "./package-install.ts";
import { createSidecarCodingTools } from "./sidecar-tools.ts";

const plan = (packages: string[]) =>
  [
    "# Build plan",
    "## In short",
    "- A booking app.",
    "## Packages",
    ...packages.map((spec) => `- \`${spec}\` for the timetable.`),
    "## Phases",
    "- `not-a-package-line` is not in the Packages section.",
  ].join("\n");

// A build plan approved at version 1 and revised to version 2, not yet approved.
const documents = [
  { kind: "build_plan", approvedVersion: 1 },
  { kind: "design", approvedVersion: 1 },
];
const versions: Record<number, string> = {
  1: plan(["xlsx@0.18.5", "date-fns"]),
  2: plan(["xlsx@0.18.5", "date-fns", "lodash@4.17.21"]),
};
const approved = async (document: { kind: string; approvedVersion: number }) =>
  document.kind === "design" ? "{}" : versions[document.approvedVersion];

const workspaces: string[] = [];
afterAll(() =>
  Promise.all(
    workspaces.map((path) => rm(path, { recursive: true, force: true })),
  ),
);

// Each gate gets its own workspace, holding packageJson when one is given.
function gate(installs: "allow" | "ask" | "deny", packageJson?: object) {
  const workspace = mkdtempSync(join(tmpdir(), "package-gate-"));
  workspaces.push(workspace);
  if (packageJson)
    writeFileSync(join(workspace, "package.json"), JSON.stringify(packageJson));
  const commands: string[] = [];
  const packageGate = createPackageGate(
    workspace,
    {
      run: async (call) => {
        commands.push(String(call.arguments["command"]));
        return { callId: call.id, content: "installed" };
      },
    },
    () => preapprovedPackages(installs, documents, approved),
  );
  const install = (packages: string[], tool = PLANNED_INSTALL_TOOL) =>
    packageGate.run(
      {
        id: "call-1",
        name: tool,
        arguments: { workspace: "server", packages },
      } satisfies ToolCall,
      AbortSignal.timeout(1000),
    );
  const shellRefusal = async (command: string) => {
    const refused = await packageGate.refuseShell(
      { id: "call-1", name: "run_shell", arguments: { command } },
      AbortSignal.timeout(1000),
    );
    if (!refused) return undefined;
    return JSON.parse(String(refused.content)).code;
  };
  return { commands, install, shellRefusal };
}

test("only install_packages waits for the person; the approved plan's install does not", () => {
  const declared = createSidecarCodingTools({
    role: "coder",
    approval: "allow",
    workspace: {
      kind: "app",
      commands: {},
      commandModules: {},
      pageWatcher: "",
      kit: "",
    },
    packageInstall: "ask",
  }).definitions;
  expect(declared).toContainEqual({
    name: PACKAGE_INSTALL_TOOL,
    approval: "ask",
  });
  expect(declared).toContainEqual({ name: PLANNED_INSTALL_TOOL });
});

test("packages the approved plan names install at its pin without asking, and say so", async () => {
  const { commands, install } = gate("ask");
  const result = await install(["xlsx", "date-fns@4.1.0"]);
  expect(result.isError).toBeUndefined();
  expect(commands).toEqual([
    "bun add --exact --cwd 'server' 'xlsx@0.18.5' 'date-fns@4.1.0'",
  ]);
  expect(result.content).toContain(
    "allowed by the approved build plan, without asking the person",
  );
});

test("a package the plan does not name, or another version than it pins, waits for the person", async () => {
  const { commands, install } = gate("ask");
  const result = await install(["left-pad", "xlsx@0.17.0"]);
  expect(result.isError).toBe(true);
  expect(commands).toEqual([]);
  expect(JSON.parse(String(result.content))).toMatchObject({
    code: "package_not_planned",
    packages: ["left-pad", "xlsx@0.17.0"],
  });

  const mixed = await install(["date-fns", "left-pad"]);
  expect(commands).toEqual(["bun add --exact --cwd 'server' 'date-fns'"]);
  expect(mixed.content).toContain(
    `Not installed: left-pad, which the approved build plan does not name at that version; install them with ${PACKAGE_INSTALL_TOOL}.`,
  );
});

test("a run whose installs are denied installs nothing the plan names", async () => {
  const { commands, install } = gate("deny");
  expect((await install(["xlsx"])).isError).toBe(true);
  expect(commands).toEqual([]);
  expect(await preapprovedPackages(undefined, documents, approved)).toEqual({
    installsFreely: false,
    documents: [],
  });
});

test("the list is the approved version's, so a revision not yet approved pre-approves nothing new", async () => {
  expect(await preapprovedPackages("ask", documents, approved)).toEqual({
    installsFreely: false,
    documents: [{ kind: "build_plan", packages: ["xlsx@0.18.5", "date-fns"] }],
  });
  const { commands, install } = gate("ask");
  expect((await install(["lodash@4.17.21"])).isError).toBe(true);
  expect(commands).toEqual([]);
  // A document with no approved version declares nothing.
  expect(
    await preapprovedPackages("ask", documents, async () => undefined),
  ).toEqual({ installsFreely: false, documents: [] });
});

test("a bare bun install takes a hand-added package only while the run installs freely", async () => {
  const handAdded = { dependencies: { "date-fns": "4.1.0" } };
  expect(
    await gate("allow", handAdded).shellRefusal("bun install"),
  ).toBeUndefined();
  expect(await gate("ask", handAdded).shellRefusal("bun install")).toBe(
    "package_install_refused",
  );
});

test("every install refuses a package from outside the registry, and the shell installs only bare", async () => {
  const { commands, shellRefusal } = gate("allow");
  expect(await shellRefusal("bun add date-fns")).toBe(
    "package_install_refused",
  );
  expect(await shellRefusal("npx some-tool")).toBe("package_install_refused");
  expect(commands).toEqual([]);
  for (const packageJson of [
    { dependencies: { thing: "github:someone/thing" } },
    { dependencies: { thing: "https://example.com/thing.tgz" } },
    { dependencies: { thing: "file:../thing" } },
    { overrides: { "date-fns": "file:../thing" } },
    { resolutions: { "date-fns": "github:someone/thing" } },
    // Bun still installs from a package.json whose name is not a string.
    { name: 5, dependencies: { thing: "file:../thing" } },
  ]) {
    const outside = gate("allow", packageJson);
    expect(await outside.shellRefusal("bun install")).toBe(
      "package_source_refused",
    );
    expect((await outside.install(["zod"], PACKAGE_INSTALL_TOOL)).isError).toBe(
      true,
    );
    expect(outside.commands).toEqual([]);
  }
});
