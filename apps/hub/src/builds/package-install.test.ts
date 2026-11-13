import { expect, test } from "bun:test";
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

function gate(installs: "allow" | "ask" | "deny") {
  const commands: string[] = [];
  const packageGate = createPackageGate(
    "/workspace",
    {
      run: async (call) => {
        commands.push(String(call.arguments["command"]));
        return { callId: call.id, content: "installed" };
      },
    },
    () => preapprovedPackages(installs, documents, approved),
  );
  const install = (packages: string[]) =>
    packageGate.run(
      {
        id: "call-1",
        name: PLANNED_INSTALL_TOOL,
        arguments: { workspace: "server", packages },
      } satisfies ToolCall,
      AbortSignal.timeout(1000),
    );
  return { commands, install };
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
    `Not installed: left-pad, which the approved build plan does not name at that version; ${PACKAGE_INSTALL_TOOL} asks the person for them.`,
  );
});

test("a run whose installs are denied installs nothing the plan names", async () => {
  const { commands, install } = gate("deny");
  expect((await install(["xlsx"])).isError).toBe(true);
  expect(commands).toEqual([]);
  expect(await preapprovedPackages(undefined, documents, approved)).toEqual({
    documents: [],
  });
});

test("the list is the approved version's, so a revision not yet approved pre-approves nothing new", async () => {
  expect(await preapprovedPackages("ask", documents, approved)).toEqual({
    documents: [{ kind: "build_plan", packages: ["xlsx@0.18.5", "date-fns"] }],
  });
  const { commands, install } = gate("ask");
  expect((await install(["lodash@4.17.21"])).isError).toBe(true);
  expect(commands).toEqual([]);
  // A document with no approved version declares nothing.
  expect(
    await preapprovedPackages("ask", documents, async () => undefined),
  ).toEqual({ documents: [] });
});
