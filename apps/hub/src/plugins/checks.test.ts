import { expect, spyOn, test } from "bun:test";
import type { ArtifactListItem } from "@corbits-builder/schemas/artifact";
import { isCheckAction } from "@corbits-builder/plugin-host/catalog";
import { CATALOG } from "./catalog.ts";
import { checkNote } from "../config/checks.ts";
import { createChecks, runLeaves, savedProject, type Row } from "./checks.ts";

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

test("a live check runs again by itself once the release it read is recorded anew", async () => {
  const release = (version: string) => ({
    "publish.release": { ...serverRelease, version },
  });
  const before = await recorded(
    "server",
    "live",
    checkedProject("first", files, {}),
  );
  expect(before.result).toBe("fail");
  expect(
    due(checkedProject("first", files, release("first"), [before])),
  ).toEqual(["server live"]);
  const published = await recorded(
    "server",
    "live",
    checkedProject("first", files, release("first")),
  );
  expect(
    due(checkedProject("second", files, release("second"), [published])),
  ).toEqual(["server live"]);
});

test("a live check is not run again when only the app changed, its record no longer stands, and it fails on the app it did not publish", async () => {
  const stored = { "publish.release": serverRelease };
  const published = await recorded(
    "server",
    "live",
    checkedProject("first", files, stored),
  );
  expect(published.result).toBe("pass");
  const edited = checkedProject("second", files, stored, [published]);
  expect(due(edited)).toEqual([]);
  expect(edited.records[0]?.current).toBe(false);
  expect(edited.facts.has("published:server")).toBe(false);
  expect(
    (await recorded("server", "live", checkedProject("second", files, stored)))
      .result,
  ).toBe("fail");
});

test("a check that re-runs on a change is not run again for a new commit alone, only once a file it read changed", async () => {
  const stored = {
    "stack.production": {
      install: "bun install --frozen-lockfile",
      build: "bun run build",
      start: "bun run start",
      port: "PORT",
      data: [],
    },
  };
  const ready = await recorded(
    "cloudflare",
    "ready",
    checkedProject("first", { "wrangler.jsonc": "{}" }, stored),
  );
  expect(
    due(checkedProject("second", { "wrangler.jsonc": "{}" }, stored, [ready])),
  ).toEqual([]);
  expect(
    due(
      checkedProject(
        "second",
        { "wrangler.jsonc": '{ "name": "app" }' },
        stored,
        [ready],
      ),
    ),
  ).toEqual(["cloudflare ready"]);
});

test("a live check re-run after a release to its own place records the pass and notes it", async () => {
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
  expect(left.note).toBe(
    checkNote({
      name: "server live",
      checkId: left.row.id,
      result: "pass",
      summary: left.row.summary,
      evidence: left.row.evidence,
    }),
  );
  expect(
    checkedProject("first", files, { "publish.release": serverRelease }, [
      left.row,
    ]).facts.has("published:server"),
  ).toBe(true);
});

test("a live check re-run after a release to another place, or after its release is cleared, leaves no record and no note, and its fact lapses", async () => {
  const published = await recorded(
    "server",
    "live",
    checkedProject("first", files, { "publish.release": serverRelease }),
  );
  expect(published.result).toBe("pass");
  for (const release of [
    {
      target: "digitalocean",
      url: "http://198.51.100.4/",
      version: "first",
      at: "2026-11-18T10:00:00.000Z",
    },
    null,
  ]) {
    const moved = checkedProject(
      "first",
      files,
      { "publish.release": release },
      [published],
    );
    expect(due(moved)).toEqual(["server live"]);
    expect(await rerun("server", "live", moved)).toBeUndefined();
    expect(standing(moved)).toEqual([{ result: "pass", current: false }]);
    expect(moved.facts.has("published:server")).toBe(false);
  }
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

test("a failed hub re-run on a value is not repeated by unrelated saves, and runs again once a value it read changes", async () => {
  const published = await recorded(
    "server",
    "live",
    checkedProject("first", files, { "publish.release": serverRelease }),
  );
  let stored: Record<string, unknown> = {
    "publish.release": { ...serverRelease, target: "digitalocean" },
  };
  const inserted: unknown[] = [];
  // A query that answers rows whichever way it is narrowed.
  const query = (rows: readonly unknown[]) => {
    const narrowed: object = Object.assign(Promise.resolve(rows), {
      from: () => narrowed,
      where: () => narrowed,
      orderBy: () => narrowed,
      innerJoin: () => narrowed,
    });
    return narrowed;
  };
  const checks = createChecks({
    db: {
      selectDistinctOn: () => query([published]),
      select: () => query([]),
      insert: () => ({
        values: async (row: unknown) => inserted.push(row),
      }),
    } as unknown as Parameters<typeof createChecks>[0]["db"],
    toolchains: {} as never,
    artifacts: {
      list: async () => ({ artifacts: [{ ...appArtifact }], preferences: {} }),
      savedApp: async () => ({ commit: "first", bundle: { files } }),
      projectState: async () => ({ styles: undefined, stored, materials: [] }),
      read: async () => ({ content: "" }),
    } as never,
    commands: {} as never,
    fetch: () => Promise.reject(new Error("no coordinator to note")),
  });
  const live = installed("server", "live");
  const runs = spyOn(live, "run");
  // How many times one save ran the live check.
  const save = async (values: Record<string, unknown>) => {
    stored = { ...stored, ...values };
    const before = runs.mock.calls.length;
    await checks.changed(
      { tenantId: "tenant", principalId: "person" },
      "project",
      "http://hub.test",
    );
    return runs.mock.calls.length - before;
  };

  try {
    expect(await save({})).toBe(1);
    expect(inserted).toEqual([]);
    expect(await save({ "look.font-primary": "Arial" })).toBe(0);
    expect(
      await save({
        "publish.release": {
          ...serverRelease,
          target: "digitalocean",
          at: "2026-11-18T10:00:00.000Z",
        },
      }),
    ).toBe(1);
    expect(inserted).toEqual([]);
  } finally {
    runs.mockRestore();
  }
});

test("a failing check run by the coordinator or the person, or re-run on a change, still records the failure and notes it", async () => {
  const elsewhere = checkedProject("first", files, {
    "publish.release": { ...serverRelease, target: "digitalocean" },
  });
  for (const triggeredBy of ["run:coordinator", "person:someone"]) {
    const left = await ranBy(triggeredBy, "server", "live", elsewhere);
    expect(left?.row.result).toBe("fail");
    expect(left?.note).toContain("failed");
  }
  const ready = await rerun(
    "server",
    "ready",
    checkedProject("first", files, { "stack.production": null }),
  );
  expect(ready?.row.result).toBe("fail");
  expect(ready?.note).toContain("failed");
});
