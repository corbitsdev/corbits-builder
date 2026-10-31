import fs, { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  open,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { createHash } from "node:crypto";
import { dirname, join, relative } from "node:path";
import { type } from "arktype";
import git, { Errors, type HttpClient } from "isomorphic-git";
import http from "isomorphic-git/http/web";
import { createSSHSignature } from "@intx/crypto";
import { getLogger } from "@intx/log";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import { hexDecode } from "@intx/types/hex";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { INPUTS_DIRECTORY } from "../config/inputs.ts";
import { requestErrorMetadata } from "../request-error.ts";
import {
  excludedFile as excludedSnapshotFile,
  linkOrGone,
} from "./app-snapshot.ts";
import {
  mediatedHttpJson,
  WorkflowHttpError,
  workflowHttpJson,
} from "@corbits-builder/tools-hub";

const AppPushAccess = type({
  path: "string",
  secret: "string",
  expiresAt: "string",
  author: { name: "string", email: "string" },
  runId: "string",
});
export type AppPushAccess = typeof AppPushAccess.infer & { url: string };

const MAIN = "refs/heads/main";
// The hub's main as of the last push from this git directory.
const PUSHED = "refs/remotes/origin/main";
// A token is renewed this long before it expires, so a push never starts on a token about to lapse.
const RENEW_BEFORE_MS = 10 * 60 * 1000;
const VERSION_MS = 120_000;
const REVOKE_MS = 10_000;
// Setup's clone is tried this many times, a second apart, before the workspace is seeded without it.
const CLONE_ATTEMPTS = 3;
const CLONE_RETRY_MS = 1000;
const LISTED_PATHS = 10;
// Failures that no change to the workspace can clear.
const PERMANENT =
  /^(app_workspace_stale|app_main_diverged|sidecar_signing_key_missing):/;
// The label of a version requested after check-app passed, and the one it falls back to when the
// files changed since the check.
export const CHECK_PASSED = "Check passed";
export const EDIT = "Edit";
// The repository carries the app's binary assets, such as images in public/, which the 1 MiB text
// artifact of the app leaves out.
const APP_REPOSITORY_MAX_BYTES = 25 * 1024 * 1024;
// A pkt-line holds at most 65520 bytes: its 4-byte length, the band byte and the data.
const SIDE_BAND_DATA = 65515;
const log = getLogger(["corbits-builder", "hub", "app-repository"]);
// Installs and builds are rebuilt by setup and check-app, .builder and the inputs come from filed
// documents, and environment files may hold secrets; the hub's app kind refuses the first two and
// environment files in any letter case (hub-sessions app-kind.ts), whose module the sidecar's tools
// cannot load without the hub's database layer.
const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  ".git",
  ".builder",
  INPUTS_DIRECTORY,
]);
const excludedDirectory = (name: string) =>
  EXCLUDED_DIRECTORIES.has(name.toLowerCase());
// The hub refuses every environment file, the example one included, so the repository drops what
// the app snapshot drops and .env.example as well.
const excludedFile = (name: string) =>
  name.toLowerCase().startsWith(".env") || excludedSnapshotFile(name);

// isomorphic-git's push always reads its result through GitSideBand.demux (index.js, _push), but
// Interchange's receive-pack answers raw report-status pkt-lines and advertises no side-band-64k
// (hub-api git-http/advertise-refs.ts:99), so the result is carried on band 1.
const hubHttp: HttpClient = {
  async request(request) {
    const response = await http.request(request);
    if (
      !request.url.endsWith("/git-receive-pack") ||
      response.statusCode !== 200 ||
      !response.body
    )
      return response;
    const chunks: Uint8Array[] = [];
    for await (const chunk of response.body) chunks.push(chunk);
    const report = Buffer.concat(chunks);
    const frames: Uint8Array[] = [];
    for (let offset = 0; offset < report.length; offset += SIDE_BAND_DATA) {
      const data = report.subarray(offset, offset + SIDE_BAND_DATA);
      frames.push(
        Buffer.from((data.length + 5).toString(16).padStart(4, "0")),
        Buffer.from([1]),
        data,
      );
    }
    return {
      ...response,
      body: (async function* () {
        yield* frames;
      })(),
    };
  },
};

const exists = (path: string) =>
  access(path).then(
    () => true,
    () => false,
  );

// isomorphic-git's clone and fetch take no signal, so the caller stops waiting on them instead.
const abortable = <T>(work: Promise<T>, signal: AbortSignal) =>
  new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });

const oneLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .trim();

const appRepositoryPath = (scope: { tenantId: string; projectId: string }) =>
  "/api/tenants/" +
  encodeURIComponent(scope.tenantId) +
  "/projects/" +
  encodeURIComponent(scope.projectId) +
  "/app-repository";

/**
 * Push access to the coder's project app repository, minted by the hub for this run. The hub
 * answers the repository's path on its API origin; the hub credential pins that origin without
 * exposing it, so it is read from the answer's URL.
 */
export async function requestAppPushAccess(
  capabilities: RuntimeCapabilities,
  scope: { tenantId: string; projectId: string },
  signal: AbortSignal,
): Promise<AppPushAccess> {
  const credential = await capabilities
    .resolve("credentials")
    .resolve(HUB_CREDENTIAL_HANDLE);
  if (credential.kind !== "http")
    throw new WorkflowHttpError(undefined, "credential_kind");
  let origin: string | undefined;
  const access = AppPushAccess.assert(
    await mediatedHttpJson({
      credential: {
        ...credential,
        fetch: async (input, init) => {
          const response = await credential.fetch(input, init);
          origin = new URL(response.url).origin;
          return response;
        },
      },
      path: appRepositoryPath(scope),
      body: {},
      maxResponseBytes: 16384,
      signal,
    }),
  );
  return { ...access, url: new URL(access.path, origin).href };
}

/**
 * Ends this run's push access: the hub revokes its tokens and removes its grants. A run that has
 * already ended is answered 401, since Interchange deletes its run tokens and deactivates its
 * principal as it ends (hub-sessions workflow-run-terminal-projection.ts:110), and git-token-auth
 * refuses a deactivated principal's tokens; its push access is over already.
 */
export async function revokeAppPushAccess(
  capabilities: RuntimeCapabilities,
  scope: { tenantId: string; projectId: string },
  signal: AbortSignal,
) {
  try {
    await workflowHttpJson({
      capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path: appRepositoryPath(scope) + "/revoke",
      body: {},
      maxResponseBytes: 1024,
      signal,
    });
  } catch (error) {
    if (error instanceof WorkflowHttpError && error.status === 401) return;
    throw error;
  }
}

/**
 * An SSH signature with the sidecar's key. Interchange hands the workflow child that key as
 * SIDECAR_SIGNING_* and signs a run's conversation commits with it (workflow-host
 * substrate-factory.ts createStepStorageSigner); the coder's tools run in that child.
 */
export async function signWithSidecarKey(payload: string) {
  const publicKey = process.env["SIDECAR_SIGNING_PUBLIC_KEY"];
  const privateKey = process.env["SIDECAR_SIGNING_PRIVATE_KEY"];
  if (!publicKey || !privateKey)
    throw new Error(
      "sidecar_signing_key_missing: SIDECAR_SIGNING_* is not set in this process",
    );
  return createSSHSignature(
    payload,
    hexDecode(privateKey),
    hexDecode(publicKey),
  );
}

class AppTooLarge extends Error {}

type Blob = { mode: string; oid: string };
type Tree = Map<string, Blob | Tree>;
type WorkspaceFile = { bytes: Buffer; executable: boolean };

export type AppRepository = ReturnType<typeof createAppRepository>;

/**
 * The workspace's app as signed commits on the project's hub repository. The git directory sits
 * beside the workspace, out of the sandbox's reach, and the push token lives only in this closure:
 * git sends it through onAuth, so no remote, URL or config file ever holds it.
 */
export function createAppRepository(options: {
  workspace: string;
  access: (signal: AbortSignal) => Promise<AppPushAccess>;
  revoke: (signal: AbortSignal) => Promise<unknown>;
  sign: (payload: string) => Promise<string>;
}) {
  const { workspace } = options;
  const gitdir = join(dirname(workspace), "app.git");
  // Marks a workspace setup seeded while the hub's main could not be cloned, so its files did not
  // come from main and are committed on top of it once the clone succeeds.
  const unattached = join(dirname(workspace), "app.unattached");
  let current: AppPushAccess | undefined;
  // The latest mint, which close waits out before it revokes.
  let minting: Promise<AppPushAccess> | undefined;
  // While closing, nothing new is scheduled; once the work under way drains, nothing mints access the
  // close would not revoke.
  let draining = false;
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>) => {
    const next = queue.then(work, work);
    queue = next.catch(() => undefined);
    return next;
  };
  const pushAccess = async (signal: AbortSignal) => {
    if (closed)
      throw new Error(
        "app_repository_closed: this run's app repository is closed",
      );
    if (
      !current ||
      Date.parse(current.expiresAt) - Date.now() < RENEW_BEFORE_MS
    ) {
      minting = options.access(signal);
      current = await minting;
    }
    return current;
  };
  const credentials = (secret: string) => () => ({
    username: "x-access-token",
    password: secret,
  });

  const tooLarge = (filepath: string) =>
    new AppTooLarge(
      `app_too_large: the app's files pass the ${APP_REPOSITORY_MAX_BYTES}-byte limit at ${filepath}`,
    );

  // Whether a directory's real location is still the one the walk reached it by.
  const inPlace = async (root: string, directory: string) =>
    (await realpath(directory)) === join(root, relative(workspace, directory));

  // Whether a file read through fd was the workspace's own: a directory swapped for a symlink
  // between the checks and the read could hand over a file from outside, such as /proc/self/environ.
  // Linux names the open file's real path. macOS's equivalent, fcntl F_GETPATH, is variadic, which
  // bun:ffi cannot call on arm64, so there the path and its directory are checked again instead.
  async function readInPlace(
    fd: number,
    root: string,
    path: string,
    opened: fs.Stats,
  ) {
    try {
      if (
        process.platform === "linux" &&
        (await readlink(`/proc/self/fd/${fd}`)) !==
          join(root, relative(workspace, path))
      )
        return false;
      const named = await lstat(path);
      if (named.dev !== opened.dev || named.ino !== opened.ino) return false;
      return await inPlace(root, dirname(path));
    } catch (error) {
      if (linkOrGone(error)) return false;
      throw error;
    }
  }

  // A regular file's bytes, opened without following a symlink; undefined when it was swapped for
  // something else or removed since it was listed. The sandbox writes the workspace, so O_NOFOLLOW
  // guards only the last component: the opened file must also be the one at its path, in a
  // directory that is still where the walk found it.
  async function readRegular(
    root: string,
    path: string,
    filepath: string,
    room: number,
  ): Promise<WorkspaceFile | undefined> {
    let file;
    try {
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (linkOrGone(error)) return undefined;
      throw error;
    }
    try {
      const stats = await file.stat();
      if (!stats.isFile()) return undefined;
      try {
        const named = await lstat(path);
        if (named.dev !== stats.dev || named.ino !== stats.ino)
          return undefined;
        if (!(await inPlace(root, dirname(path)))) return undefined;
      } catch (error) {
        if (linkOrGone(error)) return undefined;
        throw error;
      }
      if (stats.size > room) throw tooLarge(filepath);
      const bytes = await file.readFile();
      if (bytes.length > room) throw tooLarge(filepath);
      if (!(await readInPlace(file.fd, root, path, stats)))
        throw new Error(
          `app_workspace_changed: ${filepath} moved while it was read`,
        );
      return { bytes, executable: (stats.mode & 0o111) !== 0 };
    } finally {
      await file.close();
    }
  }

  // Visits each of the workspace's own files. A symlink is never followed or stored: it could carry
  // an outside file in, and the hub refuses one in a pushed tree. A directory is entered only while
  // it is still a directory whose real location is the one the walk reached it by.
  async function walk(
    root: string,
    directory: string,
    signal: AbortSignal,
    visit: (path: string, filepath: string) => Promise<void>,
  ) {
    signal.throwIfAborted();
    let entries;
    try {
      if (!(await lstat(directory)).isDirectory()) return;
      if (!(await inPlace(root, directory))) return;
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (linkOrGone(error)) return;
      throw error;
    }
    for (const entry of entries) {
      signal.throwIfAborted();
      if (!entry.isDirectory() && !entry.isFile()) continue;
      if (
        entry.isDirectory()
          ? excludedDirectory(entry.name)
          : excludedFile(entry.name)
      )
        continue;
      const path = join(directory, entry.name);
      const filepath = relative(workspace, path);
      if (await git.isIgnored({ fs, dir: workspace, gitdir, filepath }))
        continue;
      if (entry.isDirectory()) await walk(root, path, signal, visit);
      else await visit(path, filepath);
    }
  }

  // The workspace's own files by path.
  async function collect(root: string, signal: AbortSignal) {
    const files = new Map<string, WorkspaceFile>();
    let bytes = 0;
    await walk(root, workspace, signal, async (path, filepath) => {
      const file = await readRegular(
        root,
        path,
        filepath,
        APP_REPOSITORY_MAX_BYTES - bytes,
      );
      if (!file) return;
      bytes += file.bytes.length;
      files.set(filepath, file);
    });
    return files;
  }

  // The workspace's file paths with their inode, size, mode, and modification and change times:
  // unchanged while no file is written, at the cost of a stat per file rather than a read.
  async function fingerprint(signal: AbortSignal) {
    const hash = createHash("sha256");
    await walk(
      await realpath(workspace),
      workspace,
      signal,
      async (path, filepath) => {
        const stats = await lstat(path).catch((error: unknown) => {
          if (linkOrGone(error)) return undefined;
          throw error;
        });
        if (stats?.isFile())
          hash.update(
            `${filepath}\0${stats.ino}\0${stats.size}\0${stats.mode}\0${stats.mtimeMs}\0${stats.ctimeMs}\n`,
          );
      },
    );
    return hash.digest("hex");
  }

  async function writeTree(tree: Tree): Promise<string> {
    const entries = [];
    for (const [path, child] of tree)
      entries.push(
        child instanceof Map
          ? {
              mode: "040000",
              path,
              oid: await writeTree(child),
              type: "tree" as const,
            }
          : { mode: child.mode, path, oid: child.oid, type: "blob" as const },
      );
    return git.writeTree({ fs, gitdir, tree: entries });
  }

  async function flatten(
    oid: string,
    prefix = "",
    into = new Map<string, string>(),
  ) {
    for (const entry of (await git.readTree({ fs, gitdir, oid })).tree) {
      const path = prefix + entry.path;
      if (entry.type === "tree") await flatten(entry.oid, path + "/", into);
      else into.set(path, entry.oid);
    }
    return into;
  }

  // The workspace as a tree object, and its files keyed by path with their blob ids.
  async function snapshot(signal: AbortSignal) {
    const root: Tree = new Map();
    const blobs = new Map<string, string>();
    const files = await collect(await realpath(workspace), signal);
    for (const [filepath, file] of files) {
      const oid = await git.writeBlob({ fs, gitdir, blob: file.bytes });
      blobs.set(filepath, oid);
      const segments = filepath.split("/");
      let node = root;
      for (const segment of segments.slice(0, -1)) {
        let child = node.get(segment);
        if (!(child instanceof Map)) node.set(segment, (child = new Map()));
        node = child;
      }
      node.set(segments.at(-1)!, {
        mode: file.executable ? "100755" : "100644",
        oid,
      });
    }
    return { tree: await writeTree(root), blobs };
  }

  function summary(before: Map<string, string>, after: Map<string, string>) {
    const added = [...after.keys()].filter((path) => !before.has(path));
    const changed = [...after].filter(
      ([path, oid]) => before.has(path) && before.get(path) !== oid,
    );
    const removed = [...before.keys()].filter((path) => !after.has(path));
    const count = added.length + changed.length + removed.length;
    const named = [
      ...added.map((path) => `added ${path}`),
      ...changed.map(([path]) => `changed ${path}`),
      ...removed.map((path) => `removed ${path}`),
    ];
    const listed = named.slice(0, LISTED_PATHS).join(", ");
    const more =
      named.length > LISTED_PATHS
        ? ` and ${named.length - LISTED_PATHS} more`
        : "";
    return {
      title: `${count} file${count === 1 ? "" : "s"} changed`,
      body: listed + more,
    };
  }

  async function headCommit() {
    const oid = await git.resolveRef({ fs, gitdir, ref: MAIN });
    return { oid, ...(await git.readCommit({ fs, gitdir, oid })).commit };
  }

  // Fits a workspace that already holds an app to the freshly cloned main. It keeps its files when
  // they are main's, when main is still the hub's genesis commit, whose .gitignore it gains, or when
  // setup seeded them while main could not be cloned, so the next version commits them on top of
  // main. Otherwise main holds versions the workspace did not start from: before the builder starts,
  // the workspace becomes main's checkout; after, nothing is committed over them.
  async function adopt(signal: AbortSignal, starting: boolean) {
    const head = await headCommit();
    if (head.parent.length === 0) {
      if (!(await exists(join(workspace, ".gitignore")))) {
        const { blob } = await git.readBlob({
          fs,
          gitdir,
          oid: head.oid,
          filepath: ".gitignore",
        });
        await writeFile(join(workspace, ".gitignore"), blob);
      }
      return;
    }
    const { tree, blobs } = await snapshot(signal);
    if (tree === head.tree || (await exists(unattached))) return;
    if (!starting)
      throw new Error(
        `app_workspace_stale: the hub's main ${head.oid} holds versions this workspace did not start from, so its files are not committed over them`,
      );
    const kept = await flatten(head.tree);
    for (const path of blobs.keys())
      if (!kept.has(path)) await rm(join(workspace, path), { force: true });
    await git.checkout({
      fs,
      dir: workspace,
      gitdir,
      ref: "main",
      force: true,
    });
  }

  // Makes the git directory a clone of the hub's main, once.
  async function attach(signal: AbortSignal, starting: boolean) {
    if (await exists(gitdir)) return;
    const { url, secret } = await pushAccess(signal);
    const seeded = await exists(join(workspace, "package.json"));
    // A clone given up on keeps writing, so it writes beside the git directory until it completes.
    const staging = `${gitdir}.${crypto.randomUUID()}`;
    const cloning = git.clone({
      fs,
      http,
      dir: workspace,
      gitdir: staging,
      url,
      ref: "main",
      singleBranch: true,
      noTags: true,
      noCheckout: seeded,
      onAuth: credentials(secret),
    });
    const discard = () => rm(staging, { recursive: true, force: true });
    try {
      await abortable(cloning, signal);
    } catch (error) {
      void cloning.then(discard, discard);
      await discard();
      throw error;
    }
    await rename(staging, gitdir);
    try {
      if (seeded) await adopt(signal, starting);
      await rm(unattached, { force: true });
    } catch (error) {
      await rm(gitdir, { recursive: true, force: true });
      throw error;
    }
  }

  async function push(signal: AbortSignal) {
    const local = await git.resolveRef({ fs, gitdir, ref: MAIN });
    const pushed = await git
      .resolveRef({ fs, gitdir, ref: PUSHED })
      .catch(() => undefined);
    if (local === pushed) return;
    const { url, secret } = await pushAccess(signal);
    try {
      await git.push({
        fs,
        http: hubHttp,
        gitdir,
        url,
        ref: MAIN,
        remoteRef: MAIN,
        onAuth: credentials(secret),
        signal,
      });
    } catch (error) {
      if (!(error instanceof Errors.PushRejectedError)) throw error;
      const { fetchHead } = await abortable(
        git.fetch({
          fs,
          http,
          gitdir,
          url,
          ref: "main",
          singleBranch: true,
          tags: false,
          onAuth: credentials(secret),
        }),
        signal,
      );
      throw new Error(
        `app_main_diverged: the hub's main is at ${fetchHead}, which this workspace's main ${local} does not build on`,
      );
    }
    await git.writeRef({ fs, gitdir, ref: PUSHED, value: local, force: true });
  }

  // The workspace's fingerprint at its last version that reached the hub.
  let versioned: string | undefined;
  // The workspace's fingerprint when its files passed the size limit; it is not read again unchanged.
  let refused: string | undefined;

  // Commits the workspace when it differs from main, then pushes main if the hub lacks it. A
  // workspace unchanged since its last version, as after a read-only command, is left alone, and
  // one unchanged since it was refused as too large is skipped, keeping that failure. A check's
  // label names only a commit of the files it passed on: unchanged since the check, and while read.
  const version = (
    reason: string,
    checked: Promise<string> | undefined,
    signal: AbortSignal,
  ): Promise<{ commit: string | undefined } | undefined> =>
    serial(async () => {
      const files = await fingerprint(signal);
      if (files === versioned) return { commit: undefined };
      if (files === refused) return undefined;
      let created: string | undefined;
      try {
        await attach(signal, false);
        const head = await headCommit();
        const { tree, blobs } = await snapshot(signal);
        if (tree !== head.tree) {
          const label =
            checked === undefined ||
            ((await checked.catch(() => undefined)) === files &&
              (await fingerprint(signal)) === files)
              ? reason
              : EDIT;
          const { author } = await pushAccess(signal);
          const { title, body } = summary(await flatten(head.tree), blobs);
          const identity = {
            ...author,
            timestamp: Math.floor(Date.now() / 1000),
          };
          created = await git.commit({
            fs,
            gitdir,
            ref: MAIN,
            tree,
            parent: [head.oid],
            author: identity,
            committer: identity,
            message: `${label}: ${title}\n\n${body}\n`,
            signingKey: "sshsig",
            onSign: async ({ payload }) => ({
              signature: await options.sign(payload),
            }),
          });
        }
      } catch (error) {
        if (error instanceof AppTooLarge) refused = files;
        throw error;
      }
      await push(signal);
      versioned = files;
      return { commit: created };
    });

  // Aborts whatever version is running when teardown stops waiting for it.
  const teardown = new AbortController();
  const versionSignal = () =>
    AbortSignal.any([AbortSignal.timeout(VERSION_MS), teardown.signal]);
  let running: Promise<void> | undefined;
  let queued:
    | { reason: string; checked: Promise<string> | undefined }
    | undefined;
  let failure: string | undefined;
  let stopped = false;
  let heard = true;
  let lastCommit: string | undefined;
  const failed = (error: unknown) => {
    failure = oneLine(error);
    stopped = PERMANENT.test(failure);
    heard = false;
    log.error("Versioning the app failed: {reason}", {
      reason: failure,
      ...requestErrorMetadata(error),
    });
  };

  const drain = () => {
    if (running) return;
    running = (async () => {
      while (queued && !stopped) {
        const { reason, checked } = queued;
        queued = undefined;
        try {
          const outcome = await version(reason, checked, versionSignal());
          if (!outcome) continue;
          lastCommit = outcome.commit ?? lastCommit;
          failure = undefined;
        } catch (error) {
          failed(error);
        }
      }
    })().finally(() => {
      running = undefined;
      if (queued && !stopped) drain();
    });
  };

  const schedule = (reason: string) => {
    if (stopped || draining) return;
    // The files the check passed on, as of the request it makes right after passing.
    const checked =
      reason === CHECK_PASSED ? fingerprint(versionSignal()) : undefined;
    checked?.catch(() => undefined);
    queued = { reason, checked };
    drain();
  };

  const idle = async () => {
    while (running) await running;
  };

  // Setup's clone, tried again after a transient failure. Once every attempt failed, a workspace
  // setup is about to seed is marked as not from main.
  const prepare = async (signal: AbortSignal) => {
    const stopping = AbortSignal.any([signal, teardown.signal]);
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await attach(
          AbortSignal.any([stopping, AbortSignal.timeout(VERSION_MS)]),
          true,
        );
      } catch (error) {
        if (
          attempt === CLONE_ATTEMPTS ||
          stopping.aborted ||
          error instanceof AppTooLarge
        )
          throw error;
      }
      await sleep(CLONE_RETRY_MS, undefined, { signal: stopping });
    }
  };

  return {
    /**
     * Makes the workspace a checkout of the hub repository's main before the builder starts. The
     * repository being unavailable is a failure for status and the next tool result, never a
     * thrown error: the next version retries the clone.
     */
    prepare: (signal: AbortSignal) =>
      serial(() => prepare(signal))
        .catch(async (error: unknown) => {
          failed(error);
          if (await exists(join(workspace, "package.json"))) return;
          await mkdir(dirname(unattached), { recursive: true });
          await writeFile(unattached, "");
        })
        .catch((error: unknown) => failed(error)),

    /**
     * Versions the workspace in the background; the caller never waits. Requests that arrive while
     * one runs collapse into one more run, labelled by the last of them. A failure is kept for
     * status and the next tool result. The next request retries a transient one, since a push
     * carries every commit the hub lacks, and an oversized workspace once its files change; a
     * permanent one ends versioning for this run.
     */
    schedule,

    status: () => ({
      state: running ? "versioning" : failure ? "failed" : "current",
      ...(lastCommit ? { commit: lastCommit } : {}),
      ...(failure ? { error: failure } : {}),
    }),

    /** The latest failure as one line, once, for the next tool result. */
    unheard() {
      if (!failure || heard) return undefined;
      heard = true;
      return stopped
        ? `app_versioning_stopped: ${failure}; later changes in this run are not versioned`
        : `app_versioning_failed: ${failure}; the next change retries it`;
    },

    idle,

    /**
     * Refuses further requests and lets setup, the running version and the queued one finish until
     * the signal aborts them. Then it refuses push access and gives up what this run was issued, if
     * anything, within its own time limit.
     */
    async close(signal: AbortSignal) {
      draining = true;
      const stop = () => teardown.abort(signal.reason);
      signal.addEventListener("abort", stop, { once: true });
      await abortable(
        idle().then(() => queue),
        signal,
      ).catch(() => stop());
      closed = true;
      if (!minting) return;
      const revoking = AbortSignal.timeout(REVOKE_MS);
      try {
        await abortable(
          minting.catch(() => undefined),
          revoking,
        );
        await options.revoke(revoking);
        current = undefined;
      } catch (error) {
        log.error("Revoking app push access failed: {reason}", {
          reason: oneLine(error),
          ...requestErrorMetadata(error),
        });
      }
    },
  };
}
