import { expect, test } from "bun:test";
import * as fs from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import git from "isomorphic-git";
import {
  buildStepStateCheckpoint,
  WORKFLOW_RUN_REF,
  workflowRunStepStatePrefix,
} from "@intx/hub-sessions";
import { deriveWorkflowRunRepoId } from "@intx/workflow-deploy";
import { rewriteRunHistories } from "./migrate-agent-state.ts";

const runId = "run_0123456789abcdef0123456789abcdef";
const address = `${runId}@test-project.localhost`;
const author = {
  name: "hub",
  email: "hub@test",
  timestamp: 1,
  timezoneOffset: 0,
};

async function runRepo(): Promise<{ dataDir: string; dir: string }> {
  const dataDir = await mkdtemp(join(tmpdir(), "migrate-agent-state-"));
  return { dataDir, dir: await repoIn(dataDir, address) };
}

async function repoIn(dataDir: string, runAddress: string): Promise<string> {
  const dir = join(
    dataDir,
    "workflow-runs",
    deriveWorkflowRunRepoId(runAddress),
  );
  await git.init({ fs, dir, defaultBranch: "main" });
  return dir;
}

async function commit(
  dir: string,
  files: Record<string, string>,
): Promise<string> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
    await git.add({ fs, dir, filepath: path });
  }
  return git.commit({ fs, dir, message: "save", author, committer: author });
}

function turn(role: string, text: string) {
  return { role, content: [{ type: "text", text }], timestamp: 1 };
}

function checkpoint(turns: unknown[]): Record<string, string> {
  return buildStepStateCheckpoint("agent-state/coordinate/", 0, {
    turns,
    pendingOperations: [],
    tokenUsage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      thinking: 0,
    },
    connectorState: null,
  });
}

async function holdsOldDir(dir: string, oid: string): Promise<boolean> {
  const { commit: saved } = await git.readCommit({ fs, dir, oid });
  const { tree } = await git.readTree({ fs, dir, oid: saved.tree });
  return tree.some((entry) => entry.path === "agent-state");
}

test("every save is rewritten to the step-state layout, signed, with the old history kept", async () => {
  const { dataDir, dir } = await runRepo();
  await commit(dir, checkpoint([turn("user", "first")]));
  const oldTip = await commit(dir, {
    ...checkpoint([turn("user", "first"), turn("assistant", "second")]),
    "runs/marker.json": "{}",
  });
  const { commit: last } = await git.readCommit({ fs, dir, oid: oldTip });
  const oldStep = await git.readTree({
    fs,
    dir,
    oid: last.tree,
    filepath: "agent-state/coordinate",
  });

  let stops = 0;
  const stopSidecars = async () => {
    stops += 1;
  };
  await rewriteRunHistories([{ runId, address }], dataDir, stopSidecars);
  expect(stops).toBe(1);

  const newTip = await git.resolveRef({ fs, dir, ref: WORKFLOW_RUN_REF });
  const history = await git.log({ fs, dir, ref: newTip });
  expect(history).toHaveLength(2);
  for (const { oid, commit: saved } of history) {
    expect(await holdsOldDir(dir, oid)).toBe(false);
    expect(saved.gpgsig).toStartWith("-----BEGIN SSH SIGNATURE-----");
  }
  const { commit: rewritten } = await git.readCommit({ fs, dir, oid: newTip });
  const moved = await git.readTree({
    fs,
    dir,
    oid: rewritten.tree,
    filepath: workflowRunStepStatePrefix(runId, "coordinate").slice(0, -1),
  });
  expect(moved.oid).toBe(oldStep.oid);
  expect(
    await git.resolveRef({ fs, dir, ref: "refs/pre-step-state/main" }),
  ).toBe(oldTip);

  await rewriteRunHistories([{ runId, address }], dataDir, stopSidecars);
  expect(await git.resolveRef({ fs, dir, ref: WORKFLOW_RUN_REF })).toBe(newTip);
  expect(stops).toBe(1);
});

test("a history that does not read back stays as it was and the others still move", async () => {
  const { dataDir, dir } = await runRepo();
  const oldTip = await commit(dir, {
    "agent-state/coordinate/checkpoint.meta.json": "not a checkpoint",
  });
  const otherRunId = "run_fedcba9876543210fedcba9876543210";
  const otherAddress = `${otherRunId}@test-project.localhost`;
  const otherDir = await repoIn(dataDir, otherAddress);
  await commit(otherDir, checkpoint([turn("user", "first")]));
  const deployments = [
    { runId, address },
    { runId: otherRunId, address: otherAddress },
  ];

  await rewriteRunHistories(deployments, dataDir, async () => {});
  expect(await git.resolveRef({ fs, dir, ref: WORKFLOW_RUN_REF })).toBe(oldTip);
  const otherTip = await git.resolveRef({
    fs,
    dir: otherDir,
    ref: WORKFLOW_RUN_REF,
  });
  expect(await holdsOldDir(otherDir, otherTip)).toBe(false);

  await rewriteRunHistories(deployments, dataDir, async () => {});
  expect(await git.resolveRef({ fs, dir, ref: WORKFLOW_RUN_REF })).toBe(oldTip);
});

test("the sidecar's copy, ahead of the hub's, is rewritten onto the hub's new history with its files", async () => {
  const { dataDir, dir } = await runRepo();
  const sidecarDir = join(
    dataDir,
    "local-sidecars/sidecar/workflow-runs",
    deriveWorkflowRunRepoId(address),
  );
  await git.init({ fs, dir: sidecarDir, defaultBranch: "main" });
  const first = checkpoint([turn("user", "first")]);
  await commit(dir, first);
  await commit(sidecarDir, first);
  await commit(
    sidecarDir,
    checkpoint([turn("user", "first"), turn("assistant", "second")]),
  );

  await rewriteRunHistories([{ runId, address }], dataDir, async () => {});

  const hubTip = await git.resolveRef({ fs, dir, ref: WORKFLOW_RUN_REF });
  const sidecarTip = await git.resolveRef({
    fs,
    dir: sidecarDir,
    ref: WORKFLOW_RUN_REF,
  });
  expect(await holdsOldDir(sidecarDir, sidecarTip)).toBe(false);
  expect(
    await git.isDescendent({
      fs,
      dir: sidecarDir,
      oid: sidecarTip,
      ancestor: hubTip,
    }),
  ).toBe(true);
  expect(fs.existsSync(join(sidecarDir, "agent-state"))).toBe(false);
  expect(
    fs.existsSync(
      join(
        sidecarDir,
        workflowRunStepStatePrefix(runId, "coordinate"),
        "checkpoint.meta.json",
      ),
    ),
  ).toBe(true);
});
