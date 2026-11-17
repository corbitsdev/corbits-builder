import { expect, test } from "bun:test";
import type { ArtifactListItem } from "@corbits-builder/schemas/artifact";
import { savedProject, type Row } from "./checks.ts";

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
