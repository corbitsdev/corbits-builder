import * as fs from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { and, eq, isNotNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import git, { type TreeEntry } from "isomorphic-git";
import { createSSHSignature } from "@intx/crypto";
import { workflowRun } from "@intx/db/schema";
import {
  WORKFLOW_RUN_REF,
  workflowRunStepStatePrefix,
} from "@intx/hub-sessions";
import { hexEncode } from "@intx/types";
import { deriveWorkflowRunRepoId } from "@intx/workflow-deploy";
import type { MigrationEnvironment } from "./environment.ts";
import { connectDocker, removeHubSidecars } from "./provisioning/docker.ts";
import { localSidecarDataRoot } from "./sidecar/data-root.ts";
import { localSidecarDataDir } from "./sidecar/local-provisioner.ts";
import { readLocalSidecarPid } from "./sidecar/manifest-store.ts";
import { stopStaleLocalSidecar } from "./sidecar/spawn.ts";
import { loadHubSigningKey } from "./signing-key.ts";

// Interchange now keeps each agent step's conversation at
// runs/<runId>/steps/<stepId>/state/ and refuses any run history holding the
// old top-level agent-state/<stepId>/ folder, in any commit: a sidecar restore
// replays and validates the whole history. So every commit that holds the old
// folder is rewritten with that folder's subtrees moved, unchanged, to the new
// place. Delete this file, its call in migrate.ts and removeHubSidecars in
// provisioning/docker.ts once every install has started on this revision.
const OLD_DIR = "agent-state";
// Outside refs/heads and refs/tags, so Interchange never lists or ships them.
// `main` keeps the old history and is written before a copy is tried;
// `done` marks a copy with nothing left to move, so no later start reads it.
const MARKS = "refs/pre-step-state";
const OLD_HISTORY_REF = `${MARKS}/main`;
const DONE_REF = `${MARKS}/done`;

export async function moveAgentStateToStepState(
  db: PostgresJsDatabase,
  env: MigrationEnvironment,
): Promise<void> {
  const dataDir = env.HUB_DATA_DIR;
  const deployments = await db
    .select({ runId: workflowRun.id, address: workflowRun.address })
    .from(workflowRun)
    .where(
      and(
        eq(workflowRun.anchorRunId, workflowRun.id),
        isNotNull(workflowRun.address),
      ),
    );
  await rewriteRunHistories(deployments, dataDir, async (hubPublicKey) => {
    const pid = await readLocalSidecarPid(localSidecarDataRoot(dataDir));
    if (pid !== null) await stopStaleLocalSidecar(pid, 25_000);
    if (!env.SIDECAR_IMAGE) return;
    const removed = await removeHubSidecars(
      connectDocker(env.SIDECAR_DOCKER_HOST),
      env.SIDECAR_DOCKER_HUB_ID ?? hexEncode(hubPublicKey).slice(0, 24),
    );
    console.log(JSON.stringify({ sidecarContainersRemoved: removed }));
  });
}

type OnSign = (args: { payload: string }) => Promise<{ signature: string }>;

/** One copy of a run's history that still holds the old folder. */
type PendingCopy = {
  readonly dir: string;
  readonly oldTip: string;
  readonly chain: readonly string[];
  readonly start: number;
};

type PendingRun = {
  readonly runId: string;
  readonly address: string;
  readonly repoId: string;
  readonly hub: PendingCopy | null;
  readonly sidecar: PendingCopy | null;
};

/**
 * Each deployment is its anchor run's id and mail address. A run's history is
 * kept twice: the hub's copy, and the working copy of the local sidecar that
 * runs it, which may be ahead by saves the hub has not received. Both are
 * rewritten the same way, so the sidecar starts on a history that still
 * builds on the hub's and an agent stopped mid-turn resumes as on any restart.
 * `stopSidecars` runs before any copy is read, because a sidecar left running
 * would keep saving on top of what this reads and rewrites. A Docker sidecar's
 * copy is inside its container, out of reach: `stopSidecars` removes the
 * container and the hub restores its agents from the hub's copy. It runs only
 * on an install's first start on this revision: every sidecar started since
 * runs this revision's Interchange, which never saves the old folder.
 */
export async function rewriteRunHistories(
  deployments: readonly { runId: string; address: string | null }[],
  dataDir: string,
  stopSidecars: (hubPublicKey: Uint8Array) => Promise<void>,
): Promise<void> {
  const hubRuns = join(dataDir, "workflow-runs");
  const sidecarRuns = join(
    localSidecarDataDir(localSidecarDataRoot(dataDir)),
    "workflow-runs",
  );
  const signingKey = await loadHubSigningKey(dataDir);
  const sidecarsStopped = join(dataDir, "pre-step-state-sidecars-stopped");
  if (!fs.existsSync(sidecarsStopped)) {
    await stopSidecars(signingKey.publicKey);
    await writeFile(sidecarsStopped, "");
  }
  const pending: PendingRun[] = [];
  for (const { runId, address } of deployments) {
    if (address === null) continue;
    const repoId = deriveWorkflowRunRepoId(address);
    const hub = await pendingCopy(join(hubRuns, repoId), address);
    const sidecar = await pendingCopy(join(sidecarRuns, repoId), address);
    if (hub !== null || sidecar !== null)
      pending.push({ runId, address, repoId, hub, sidecar });
  }
  if (pending.length === 0) return;
  // A commit's signature covers its tree id, which the move changes, so each
  // rewritten commit is signed again with the hub's key, as the store signs.
  const onSign: OnSign = async ({ payload }) => ({
    signature: await createSSHSignature(
      payload,
      signingKey.privateKey,
      signingKey.publicKey,
    ),
  });
  for (const run of pending) {
    // One history that cannot be moved must not keep Builder from starting:
    // it stays as it was, and every later start tries it again.
    try {
      for (const copy of [run.hub, run.sidecar]) {
        if (copy === null) continue;
        await git.writeRef({
          fs,
          dir: copy.dir,
          ref: OLD_HISTORY_REF,
          value: copy.oldTip,
          force: true,
        });
      }
      if (run.hub !== null) await moveHubCopy(run, run.hub, onSign);
      if (run.sidecar !== null)
        await moveSidecarCopy(
          run,
          run.sidecar,
          join(hubRuns, run.repoId),
          onSign,
        );
    } catch (error) {
      notMoved(run.address, error);
    }
  }
}

function notMoved(address: string, error: unknown): void {
  console.error(
    JSON.stringify({ agentStateNotMoved: address, error: String(error) }),
  );
}

/** A copy that cannot be read stays as it was without holding back the other. */
async function pendingCopy(
  dir: string,
  address: string,
): Promise<PendingCopy | null> {
  if (!fs.existsSync(join(dir, ".git"))) return null;
  try {
    const marks = await git.listRefs({ fs, dir, filepath: MARKS });
    if (marks.includes(basename(DONE_REF))) return null;
    const oldTip = await git.resolveRef({ fs, dir, ref: WORKFLOW_RUN_REF });
    const chain = await firstParentChain(dir, oldTip);
    const start = await firstIndexHolding(dir, chain);
    if (start === -1) {
      await git.writeRef({ fs, dir, ref: DONE_REF, value: oldTip });
      return null;
    }
    return { dir, oldTip, chain, start };
  } catch (error) {
    notMoved(address, error);
    return null;
  }
}

/** Writes the rewritten commits beside the old ones; no ref moves. */
async function rewriteCommits(
  { dir, chain, start }: PendingCopy,
  runId: string,
  onSign: OnSign,
): Promise<string[]> {
  let parent = chain[start - 1];
  const commits: string[] = [];
  for (const oid of chain.slice(start)) {
    const { commit } = await git.readCommit({ fs, dir, oid });
    parent = await git.commit({
      fs,
      dir,
      noUpdateBranch: true,
      message: commit.message,
      tree: await movedTree(dir, commit.tree, runId),
      parent: parent === undefined ? [] : [parent],
      author: commit.author,
      committer: commit.committer,
      signingKey: "sshsig",
      onSign,
    });
    commits.push(parent);
  }
  return commits;
}

async function moveHubCopy(
  { runId, address }: PendingRun,
  copy: PendingCopy,
  onSign: OnSign,
): Promise<void> {
  const { dir, oldTip } = copy;
  const commits = await rewriteCommits(copy, runId, onSign);
  const newTip = commits.at(-1) ?? oldTip;
  await git.writeRef({
    fs,
    dir,
    ref: WORKFLOW_RUN_REF,
    value: newTip,
    force: true,
  });
  await git.writeRef({ fs, dir, ref: DONE_REF, value: newTip });
  console.log(
    JSON.stringify({
      agentStateMoved: address,
      commitsRewritten: commits.length,
      oldTip,
      newTip,
    }),
  );
}

/**
 * The sidecar's copy holds the hub's commits and any saves after them, so its
 * rewrite must pass through the hub's new tip: the sidecar's next save then
 * builds on what the hub holds. The hub's tip may also be a commit before the
 * first one holding the old folder, which the rewrite leaves as it was. Its
 * checked-out files move with it. A copy that does not build on the hub's is
 * set aside, out of the sidecar's sight, and the sidecar's deploy takes the
 * hub's copy instead. With no hub copy beside it, the sidecar's is the run's
 * only copy and is moved on its own.
 */
async function moveSidecarCopy(
  { runId, address }: PendingRun,
  copy: PendingCopy,
  hubDir: string,
  onSign: OnSign,
): Promise<void> {
  const { dir, oldTip, chain, start } = copy;
  const commits = await rewriteCommits(copy, runId, onSign);
  if (fs.existsSync(join(hubDir, ".git"))) {
    const hubTip = await git.resolveRef({
      fs,
      dir: hubDir,
      ref: WORKFLOW_RUN_REF,
    });
    if (!chain.slice(0, start).includes(hubTip) && !commits.includes(hubTip))
      return setAside(dir, address);
  }
  const oldDir = join(dir, OLD_DIR);
  for (const key of fs.existsSync(oldDir) ? await readdir(oldDir) : []) {
    const stepId = decodeURIComponent(key);
    const to = join(dir, workflowRunStepStatePrefix(runId, stepId));
    await mkdir(dirname(to), { recursive: true });
    await rename(join(oldDir, key), to);
  }
  await rm(oldDir, { recursive: true, force: true });
  const newTip = commits.at(-1) ?? oldTip;
  await git.writeRef({
    fs,
    dir,
    ref: WORKFLOW_RUN_REF,
    value: newTip,
    force: true,
  });
  await git.writeRef({ fs, dir, ref: DONE_REF, value: newTip });
  console.log(
    JSON.stringify({
      sidecarCopyMoved: address,
      commitsRewritten: commits.length,
    }),
  );
}

// Beside workflow-runs/, which the sidecar scans for deployments to restore.
async function setAside(dir: string, address: string): Promise<void> {
  const aside = join(
    dirname(dirname(dir)),
    "workflow-runs-pre-step-state",
    basename(dir),
  );
  await mkdir(dirname(aside), { recursive: true });
  await rename(dir, aside);
  console.log(JSON.stringify({ sidecarCopySetAside: address, aside }));
}

async function firstParentChain(dir: string, tip: string): Promise<string[]> {
  const chain: string[] = [];
  let oid: string | undefined = tip;
  while (oid !== undefined) {
    const { commit } = await git.readCommit({ fs, dir, oid });
    if (commit.parent.length > 1)
      throw new Error(`${dir}: merge commit ${oid} in run history`);
    chain.push(oid);
    oid = commit.parent[0];
  }
  return chain.reverse();
}

async function firstIndexHolding(
  dir: string,
  chain: readonly string[],
): Promise<number> {
  for (const [index, oid] of chain.entries()) {
    const { commit } = await git.readCommit({ fs, dir, oid });
    const { tree } = await git.readTree({ fs, dir, oid: commit.tree });
    if (tree.some((entry) => entry.path === OLD_DIR)) return index;
  }
  return -1;
}

/**
 * The commit's tree with each agent-state/<key>/ subtree placed, by object id,
 * at runs/<runId>/steps/<key>/state/.
 */
async function movedTree(
  dir: string,
  rootOid: string,
  runId: string,
): Promise<string> {
  const { tree: root } = await git.readTree({ fs, dir, oid: rootOid });
  const old = root.find((entry) => entry.path === OLD_DIR);
  if (old === undefined) return rootOid;
  let next = await git.writeTree({
    fs,
    dir,
    tree: root.filter((entry) => entry !== old),
  });
  for (const step of (await git.readTree({ fs, dir, oid: old.oid })).tree) {
    const stepId = decodeURIComponent(step.path);
    const segments = workflowRunStepStatePrefix(runId, stepId)
      .split("/")
      .slice(0, -1);
    next = await placeTree(dir, next, segments, step.oid);
  }
  return next;
}

async function placeTree(
  dir: string,
  treeOid: string | null,
  path: string[],
  oid: string,
): Promise<string> {
  const [name, ...rest] = path;
  if (name === undefined) return oid;
  const entries: TreeEntry[] =
    treeOid === null
      ? []
      : (await git.readTree({ fs, dir, oid: treeOid })).tree;
  const existing = entries.find((entry) => entry.path === name);
  const child = await placeTree(dir, existing?.oid ?? null, rest, oid);
  return git.writeTree({
    fs,
    dir,
    tree: [
      ...entries.filter((entry) => entry !== existing),
      { mode: "040000", path: name, oid: child, type: "tree" },
    ],
  });
}
