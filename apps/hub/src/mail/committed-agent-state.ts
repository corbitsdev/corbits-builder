import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream";

// Same ref the workflow-run pack receive updates. That receive stores objects
// and advances the ref; it does not check the worktree out. A reader that
// walks the working tree sees an empty mirror after a successful pack.
const MIRROR_REF = "refs/heads/main";

function capture(args: string[]): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      out.push(chunk);
    });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString("utf8") });
    });
  });
}

function extractArchive(repoDir: string, dest: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const archive = spawn(
      "git",
      ["-C", repoDir, "archive", "--format=tar", MIRROR_REF, "agent-state"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const extract = spawn("tar", ["-x", "-C", dest], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    archive.stderr.resume();
    extract.stderr.resume();
    // A tar that exits early breaks the pipe; both exit codes report that, while an unhandled
    // EPIPE would take the hub down and a bare pipe() would leave git blocked on a full pipe.
    pipeline(archive.stdout, extract.stdin, () => {});
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      archive.kill();
      extract.kill();
      reject(error);
    };
    archive.on("error", fail);
    extract.on("error", fail);
    let archiveCode = 1;
    let extractCode = 1;
    let archiveDone = false;
    let extractDone = false;
    const finish = () => {
      if (settled || !archiveDone || !extractDone) return;
      settled = true;
      resolve(archiveCode === 0 && extractCode === 0 ? 0 : 1);
    };
    archive.on("close", (code) => {
      archiveCode = code ?? 1;
      archiveDone = true;
      finish();
    });
    extract.on("close", (code) => {
      extractCode = code ?? 1;
      extractDone = true;
      finish();
    });
  });
}

/**
 * Run `read` against `agent-state/` from the committed workflow-run ref.
 * Returns undefined when that tree is not committed yet. The temp copy is
 * removed before this returns, including when `read` throws.
 */
export async function withCommittedAgentState<T>(
  repoDir: string,
  read: (agentStateRoot: string) => Promise<T>,
): Promise<T | undefined> {
  const listed = await capture([
    "-C",
    repoDir,
    "ls-tree",
    "-d",
    "--name-only",
    MIRROR_REF,
    "agent-state",
  ]);
  if (listed.code !== 0 || listed.stdout.trim() !== "agent-state")
    return undefined;
  const dest = await mkdtemp(join(tmpdir(), "sb-agent-state-"));
  try {
    if ((await extractArchive(repoDir, dest)) !== 0) return undefined;
    return await read(join(dest, "agent-state"));
  } finally {
    await rm(dest, { recursive: true, force: true });
  }
}
