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
} from "@corbits-builder/schemas/artifact";
import {
  EXCLUDED_DIRECTORIES,
  addBundleFile,
  bundleContent,
  excludedFile,
  holdsApp,
} from "@corbits-builder/schemas/app-files";
import { WorkflowHttpError, workflowHttpJson } from "../workflows/http-json.ts";
import { spliceDesignScreens } from "./starter.ts";

// The rules for which files are the app's and how they pack live with the schemas, so the UI's
// repository import and the import script pack a person's code the way the hub packs a workspace.
export {
  EXCLUDED_DIRECTORIES,
  addBundleFile,
  bundleContent,
  bundleFiles,
  excludedFile,
  holdsApp,
} from "@corbits-builder/schemas/app-files";

// Byte-order marks stay in the text, so a file reads back exactly as it was.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export const linkOrGone = (error: unknown) =>
  error instanceof Error &&
  "code" in error &&
  (error.code === "ELOOP" || error.code === "ENOENT");

/** Whether a workspace holds an app yet; one not made yet holds none. */
export async function workspaceHoldsApp(workspace: string) {
  try {
    return holdsApp(await readdir(workspace));
  } catch (error) {
    if (linkOrGone(error)) return false;
    throw error;
  }
}

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
  if (root === undefined && files["designs/index.html"] !== undefined) {
    const screens = Object.fromEntries(
      Object.entries(files).filter(
        ([path]) =>
          path.startsWith("designs/screens/") && path.endsWith(".html"),
      ),
    );
    if (Object.keys(screens).length > 0)
      files["designs/index.html"] = spliceDesignScreens(
        files["designs/index.html"],
        screens,
      );
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

// The workspace as app document content, checked against the app limit.
export async function appContent(workspace: string) {
  return bundleContent(await collectApp(workspace)).content;
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
  const body = await unlessNotFound(
    workflowHttpJson({
      capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path: projectPath(scope) + "/artifacts/" + encodeURIComponent(kind),
      // The app is as large as it is; memory is what bounds the read.
      maxResponseBytes: Number.POSITIVE_INFINITY,
      signal,
    }),
  );
  return body === undefined ? undefined : ArtifactContent.assert(body);
}

const readDesignFiles = async (
  capabilities: RuntimeCapabilities,
  path: string,
  signal: AbortSignal,
) => {
  const body = await unlessNotFound(
    workflowHttpJson({
      capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path,
      maxResponseBytes: Number.POSITIVE_INFINITY,
      signal,
    }),
  );
  return body === undefined ? undefined : DesignDraft.assert(body).files;
};

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

// Saves the starter a first build's workspace began from as the project's stack.starter, so a
// later change starts the coder that fits the code. The build action writes it.
export async function recordStarter(
  capabilities: RuntimeCapabilities,
  scope: { tenantId: string; projectId: string },
  starter: string,
  signal: AbortSignal,
) {
  await workflowHttpJson({
    capabilities,
    handle: HUB_CREDENTIAL_HANDLE,
    path: projectPath(scope) + "/run-values",
    body: { values: { "stack.starter": starter } },
    maxResponseBytes: 16384,
    signal,
  });
}
