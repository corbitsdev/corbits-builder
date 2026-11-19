import { expect, test } from "bun:test";
import type { ArtifactListItem } from "@corbits-builder/schemas/artifact";
import { isCheckAction } from "@corbits-builder/plugin-host/catalog";
import { CATALOG } from "./catalog.ts";
import { runLeaves, savedProject, type Row } from "./checks.ts";

const appArtifact: ArtifactListItem = {
  artifactId: "app",
  kind: "app",
  title: "App",
  version: 1,
  sha256: "a".repeat(64),
  filedAt: new Date(0).toISOString(),
};

test("a check's command reaches the hosts the project's builds reach", async () => {
  const asked: boolean[] = [];
  const project = (internet: "yes" | "no", rows: Row[] = []) =>
    savedProject({
      listed: {
        artifacts: [],
        preferences: { internet_while_building: internet },
      },
      app: { commit: "abc", bundle: { files: { "CHECKS.txt": "cargo test" } } },
      state: { styles: undefined, stored: {}, materials: [] },
      rows,
      readDocument: async () => "",
      runCommand: async (_bundle, _command, _timeoutSeconds, openNetwork) => {
        asked.push(openNetwork);
        return { step: 0, exitCode: 0, output: "", timedOut: false };
      },
    });
  for (const internet of ["yes", "no"] as const)
    await project(internet)
      .view()
      .saved.app.run({ lines: ["cargo test"] }, 60);
  expect(asked).toEqual([true, false]);
  const { saved, versions } = project("no").view();
  await saved.app.run({ lines: ["cargo test"] }, 60);
  const row: Row = {
    id: "check",
    tenantId: "tenant",
    projectId: "project",
    plugin: "coder",
    action: "check",
    input: {},
    versions,
    result: "pass",
    summary: "passed",
    evidence: [],
    triggeredBy: "hub",
    skippedBy: null,
    createdAt: new Date(),
  };
  expect(project("no", [row]).records[0]?.current).toBe(true);
  expect(project("yes", [row]).records[0]?.current).toBe(false);
});

test("a check's approval means what the project's facts mean, handed-over approvals included", async () => {
  const approvedFor = (
    preferences: Record<string, string>,
    approvedVersion: number | undefined,
  ) => {
    const plan: ArtifactListItem = {
      artifactId: "plan",
      kind: "build_plan",
      title: "Build plan",
      version: 2,
      sha256: "a".repeat(64),
      filedAt: new Date(0).toISOString(),
    };
    if (approvedVersion !== undefined) plan.approvedVersion = approvedVersion;
    return savedProject({
      listed: { artifacts: [plan], preferences },
      app: undefined,
      state: { styles: undefined, stored: {}, materials: [] },
      rows: [],
      readDocument: async () => "",
      runCommand: async () => ({
        step: 0,
        exitCode: 0,
        output: "",
        timedOut: false,
      }),
    })
      .view()
      .saved.approvals("build_plan");
  };
  expect(await approvedFor({ agent_decides_approvals: "yes" }, undefined)).toBe(
    true,
  );
  expect(await approvedFor({}, 1)).toBe(true);
  expect(await approvedFor({}, undefined)).toBe(false);
});

// The project at an app version with its stored values, and a record of an installed check run on it.
const checkedProject = (
  commit: string,
  files: Record<string, string>,
  stored: Record<string, unknown>,
  rows: Row[] = [],
) =>
  savedProject({
    listed: { artifacts: [{ ...appArtifact }], preferences: {} },
    app: { commit, bundle: { files } },
    state: { styles: undefined, stored, materials: [] },
    rows,
    readDocument: async () => "",
    runCommand: async () => ({
      step: 0,
      exitCode: 0,
      output: "",
      timedOut: false,
    }),
  });

// An installed check, as the hub runs it.
const installed = (plugin: string, action: string) => {
  const check = CATALOG.actions
    .filter(isCheckAction)
    .find((each) => each.plugin === plugin && each.action === action);
  if (!check) throw new Error(`${plugin} ${action} is not installed`);
  return check;
};

// One run of an installed check on the project by whoever triggeredBy names, as the hub keeps it:
// the record it adds and the note the coordinator may be sent of it, or nothing.
const ranBy = async (
  triggeredBy: string,
  plugin: string,
  action: string,
  project: ReturnType<typeof checkedProject>,
) => {
  const check = installed(plugin, action);
  const { saved, versions } = project.view();
  const outcome = await check.run(
    { ...saved, check: () => Promise.reject(new Error("no ready-made check")) },
    {},
  );
  const left = runLeaves(
    check,
    { projectId: "project", input: {} },
    { id: `${plugin}-${action}`, tenantId: "tenant", triggeredBy },
    { outcome, versions },
  );
  return (
    left && {
      row: { ...left.record, skippedBy: null, createdAt: new Date() } as Row,
      note: left.note,
    }
  );
};

// The record a run the coordinator asked for adds, which every run it asks for does.
const recorded = async (
  plugin: string,
  action: string,
  project: ReturnType<typeof checkedProject>,
): Promise<Row> => {
  const left = await ranBy("run:coordinator", plugin, action, project);
  if (!left) throw new Error(`${plugin} ${action} left no record`);
  return left.row;
};

// A re-run the hub starts by itself.
const rerun = (
  plugin: string,
  action: string,
  project: ReturnType<typeof checkedProject>,
) => ranBy("hub", plugin, action, project);

const due = (project: ReturnType<typeof checkedProject>) =>
  project.due.map(({ record }) => `${record.plugin} ${record.action}`);

const standing = (project: ReturnType<typeof checkedProject>) =>
  project.records.map(({ result, current }) => ({ result, current }));

const files = { "package.json": "{}" };

const serverRelease = {
  target: "server",
  url: "http://203.0.113.7/",
  version: "first",
  at: "2026-11-17T10:00:00.000Z",
};

test("server ready makes ready:server true for an app that says how it runs in production", async () => {
  const stored = {
    "stack.production": {
      install: "bun install --frozen-lockfile",
      build: "bun run build",
      start: "bun run start",
      port: "PORT",
      data: ["server/data"],
    },
  };
  const ready = await recorded(
    "server",
    "ready",
    checkedProject("first", files, stored),
  );
  expect(ready.result).toBe("pass");
  expect(
    checkedProject("first", files, stored, [ready]).facts.has("ready:server"),
  ).toBe(true);
});

test("a live check re-run after a release to its own place records the pass, and runs again once the release is recorded anew", async () => {
  const unpublished = await recorded(
    "server",
    "live",
    checkedProject("first", files, {}),
  );
  expect(unpublished.result).toBe("fail");
  const released = checkedProject(
    "first",
    files,
    { "publish.release": serverRelease },
    [unpublished],
  );
  expect(due(released)).toEqual(["server live"]);
  const left = await rerun("server", "live", released);
  if (!left) throw new Error("the re-run left no record");
  expect(left.row.result).toBe("pass");
  expect(
    checkedProject("first", files, { "publish.release": serverRelease }, [
      left.row,
    ]).facts.has("published:server"),
  ).toBe(true);

  // A release recorded anew makes it due again.
  expect(
    due(
      checkedProject(
        "second",
        files,
        { "publish.release": { ...serverRelease, version: "second" } },
        [left.row],
      ),
    ),
  ).toEqual(["server live"]);
});

test("a removable check re-run records the person's take-down answer, and a new release leaves no record", async () => {
  const shown = { "publish.release": serverRelease };
  const answered = {
    ...shown,
    "publish.take-down": { target: "server", release: serverRelease.at },
  };
  const unasked = await recorded(
    "server",
    "removable",
    checkedProject("first", files, shown),
  );
  expect(unasked.result).toBe("fail");
  const asked = checkedProject("first", files, answered, [unasked]);
  expect(due(asked)).toEqual(["server removable"]);
  const removable = (await rerun("server", "removable", asked))?.row;
  if (!removable) throw new Error("the re-run left no record");
  expect(removable.result).toBe("pass");
  expect(
    checkedProject("first", files, answered, [removable]).facts.has(
      "removable:server",
    ),
  ).toBe(true);

  const republished = checkedProject(
    "second",
    files,
    {
      ...answered,
      "publish.release": {
        ...serverRelease,
        version: "second",
        at: "2026-11-18T10:00:00.000Z",
      },
    },
    [removable],
  );
  expect(due(republished)).toEqual(["server removable"]);
  expect(await rerun("server", "removable", republished)).toBeUndefined();
  expect(standing(republished)).toEqual([{ result: "pass", current: false }]);
  expect(republished.facts.has("removable:server")).toBe(false);
});
