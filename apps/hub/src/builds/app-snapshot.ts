import { type } from "arktype";
import ignore, { type Ignore } from "ignore";
import { constants } from "node:fs";
import { open, readdir, realpath } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import {
  AppBundle,
  ArtifactContent,
  ArtifactReceipt,
  DesignDraft,
  MAX_APP_BYTES,
} from "@corbits-builder/schemas/artifact";
import {
  WorkflowHttpError,
  workflowHttpJson,
} from "@corbits-builder/tools-hub";
import { INPUTS_DIRECTORY } from "../config/inputs.ts";

// Installs and builds are rebuilt by setup and check-app, and .builder and the inputs come from
// filed documents.
export const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  ".git",
  ".builder",
  INPUTS_DIRECTORY,
]);
// Secrets (environment files, keys, registry credentials) and local databases never leave the
// workspace; an example environment file holds no secret and documents the app's settings.
const EXCLUDED_FILE =
  /^(\.env(\..*)?|\.npmrc|\.dev\.vars|.*\.(db|db-wal|db-shm|pem|key|p12)|.*\.sqlite.*)$/;
export const excludedFile = (name: string) => {
  const lower = name.toLowerCase();
  return lower !== ".env.example" && EXCLUDED_FILE.test(lower);
};
// Byte-order marks stay in the text, so a file reads back exactly as it was.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export const linkOrGone = (error: unknown) =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ELOOP" || error.code === "ENOENT");

// A path's real location is still the one the walk reached it by: no directory on its way was
// swapped for a symlink since it was listed.
async function contained(root: string, workspace: string, path: string) {
  try {
    return (await realpath(path)) === join(root, relative(workspace, path));
  } catch (error) {
    if (linkOrGone(error)) return false;
    throw error;
  }
}

// A regular file's bytes, opened without following a symlink from a directory still inside the
// workspace; undefined when it was swapped for a link or removed since it was listed. The sandbox
// writes the workspace, and its $HOME sits beside it.
async function readContained(root: string, workspace: string, path: string) {
  if (!(await contained(root, workspace, dirname(path)))) return undefined;
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (linkOrGone(error)) return undefined;
    throw error;
  }
  try {
    return (await file.stat()).isFile() ? await file.readFile() : undefined;
  } finally {
    await file.close();
  }
}

// The app's source as text keyed by workspace path. Only regular files inside the workspace are
// read, and a file that is not UTF-8 text is left out.
export async function packApp(
  workspace: string,
  directory = workspace,
  root?: string,
): Promise<Record<string, string>> {
  const real = root ?? (await realpath(workspace));
  const files: Record<string, string> = {};
  if (!(await contained(real, workspace, directory))) return files;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name))
        Object.assign(files, await packApp(workspace, path, real));
    } else if (entry.isFile() && !excludedFile(entry.name)) {
      const bytes = await readContained(real, workspace, path);
      if (bytes === undefined) continue;
      try {
        files[relative(workspace, path)] = utf8.decode(bytes);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
      }
    }
  }
  return files;
}

// A workspace's files as an app bundle: what its .gitignore files leave in, never the excluded
// directories or environment files. UTF-8 files are kept as text and the rest base64-encoded under
// binary. Only regular files inside the workspace are read, as packApp reads them.
export async function collectApp(
  workspace: string,
  directory = workspace,
  ignores: readonly { base: string; rules: Ignore }[] = [],
  root?: string,
): Promise<Required<AppBundle>> {
  const real = root ?? (await realpath(workspace));
  const bundle: Required<AppBundle> = { files: {}, binary: {} };
  if (!(await contained(real, workspace, directory))) return bundle;
  const entries = await readdir(directory, { withFileTypes: true });
  const gitignore = entries.some(
    (entry) => entry.isFile() && entry.name === ".gitignore",
  )
    ? await readContained(real, workspace, join(directory, ".gitignore"))
    : undefined;
  const scoped = gitignore
    ? [
        ...ignores,
        { base: directory, rules: ignore().add(gitignore.toString("utf8")) },
      ]
    : ignores;
  const ignored = (path: string, isDirectory: boolean) =>
    scoped.some(({ base, rules }) =>
      rules.ignores(relative(base, path) + (isDirectory ? "/" : "")),
    );
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRECTORIES.has(entry.name) || ignored(path, true)) continue;
      const nested = await collectApp(workspace, path, scoped, real);
      Object.assign(bundle.files, nested.files);
      Object.assign(bundle.binary, nested.binary);
    } else if (
      entry.isFile() &&
      !excludedFile(entry.name) &&
      !ignored(path, false)
    ) {
      const bytes = await readContained(real, workspace, path);
      if (bytes !== undefined)
        addBundleFile(bundle, relative(workspace, path), bytes);
    }
  }
  return bundle;
}

// Keeps a UTF-8 file as text and any other base64-encoded under binary.
export function addBundleFile(
  bundle: Required<AppBundle>,
  path: string,
  bytes: Uint8Array,
) {
  try {
    bundle.files[path] = utf8.decode(bytes);
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    bundle.binary[path] = Buffer.from(bytes).toString("base64");
  }
}

// A bundle's files as they are written to disk: text as is, binaries decoded.
export function bundleFiles(bundle: {
  files: Readonly<Record<string, string>>;
  binary?: Readonly<Record<string, string>>;
}): Record<string, string | Uint8Array> {
  return {
    ...bundle.files,
    ...Object.fromEntries(
      Object.entries(bundle.binary ?? {}).map(([path, data]) => [
        path,
        Buffer.from(data, "base64"),
      ]),
    ),
  };
}

export class AppTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`app_too_large: ${bytes} bytes; the limit is ${MAX_APP_BYTES}`);
  }
}

// Keys in order, so the same files always make the same content and an unchanged app files nothing.
const sorted = (record: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

// The workspace as app document content, checked against the app limit.
export async function appContent(workspace: string) {
  return bundleContent(await collectApp(workspace)).content;
}

// Collected files as an app bundle and its document content, checked against the app limit.
export function bundleContent(collected: Required<AppBundle>) {
  const files = sorted(collected.files);
  const binary = sorted(collected.binary);
  const bundle = AppBundle(
    Object.keys(binary).length ? { files, binary } : { files },
  );
  if (bundle instanceof type.errors)
    throw new Error("invalid_app: " + bundle.summary);
  const content = JSON.stringify(bundle);
  const bytes = Buffer.byteLength(content);
  if (bytes > MAX_APP_BYTES) throw new AppTooLargeError(bytes);
  return { bundle, content };
}

const projectPath = (scope: { tenantId: string; projectId: string }) =>
  "/api/tenants/" +
  encodeURIComponent(scope.tenantId) +
  "/projects/" +
  encodeURIComponent(scope.projectId);

async function unlessNotFound<T>(read: Promise<T>) {
  try {
    return await read;
  } catch (error) {
    if (error instanceof WorkflowHttpError && error.status === 404)
      return undefined;
    throw error;
  }
}

// Files the workspace as the next version of the project's app document, so an export carries the
// app and an imported project's coder starts from it. The hub files nothing when its main line
// already holds exactly this content; the result names the version that holds it.
export async function fileApp(
  capabilities: RuntimeCapabilities,
  scope: { tenantId: string; projectId: string },
  workspace: string,
  signal: AbortSignal,
) {
  const content = await appContent(workspace);
  const { artifact } = ArtifactReceipt.assert(
    await workflowHttpJson({
      capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path: projectPath(scope) + "/artifacts",
      body: { kind: "app", title: "App", content },
      maxResponseBytes: 16384,
      signal,
    }),
  );
  return artifact.version;
}

// The current version of the project's document of one kind, or undefined when none is filed yet.
export async function readFiledDocument(
  capabilities: RuntimeCapabilities,
  scope: { tenantId: string; projectId: string },
  kind: string,
  signal: AbortSignal,
) {
  return unlessNotFound(
    workflowHttpJson({
      capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path: projectPath(scope) + "/artifacts/" + encodeURIComponent(kind),
      // An app bundle's JSON is escaped again inside the response.
      maxResponseBytes: 2 * MAX_APP_BYTES + 16384,
      signal,
    }).then((body) => ArtifactContent.assert(body)),
  );
}

const readDesignFiles = (
  capabilities: RuntimeCapabilities,
  path: string,
  signal: AbortSignal,
) =>
  unlessNotFound(
    workflowHttpJson({
      capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path,
      maxResponseBytes: 2 * MAX_APP_BYTES,
      signal,
    }).then((body) => DesignDraft.assert(body).files),
  );

// The draft an earlier designer run left for this run's concept, if any.
export async function readPreviousDesignDraft(
  capabilities: RuntimeCapabilities,
  scope: { tenantId: string; projectId: string },
  signal: AbortSignal,
) {
  return readDesignFiles(
    capabilities,
    projectPath(scope) + "/design-draft/previous",
    signal,
  );
}

// The design theme this designer run's concept starts from, if it names one.
export async function readRunDesignTheme(
  capabilities: RuntimeCapabilities,
  scope: { tenantId: string; projectId: string },
  signal: AbortSignal,
) {
  return readDesignFiles(
    capabilities,
    projectPath(scope) + "/design-themes/run",
    signal,
  );
}
