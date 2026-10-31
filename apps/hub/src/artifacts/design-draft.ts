import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type } from "arktype";
import { workflowRunRepoIdForAddress } from "@intx/hub-sessions";
import { hasCode } from "@intx/types";
import { packApp } from "../builds/app-snapshot.ts";
import { parseJson } from "../lib/json.ts";
import { ProjectError } from "../projects/errors.ts";
import { DESIGN_STYLES } from "./design-tweaks.ts";
import { designStarterFiles } from "@corbits-builder/designer/skills" with { type: "macro" };

const STARTER_INDEX = designStarterFiles()[".builder/designs/index.html"];

// A warm single-step agent's workspace lives at
// <SIDECAR_DATA_DIR>/workflow-step-state/<run repo id>/warm/<step id>/workspace
// (HARNESS_DESIGN.md data layout; substrate-factory.ts warmStepStorageRoot).
export function warmStepWorkspace(
  sidecarDataDir: string,
  address: string,
  stepId: string,
) {
  return join(
    sidecarDataDir,
    "workflow-step-state",
    workflowRunRepoIdForAddress(address).id,
    "warm",
    encodeURIComponent(stepId),
    "workspace",
  );
}

// The mockup the designer is writing, keyed as the design bundle keys it (designs/...), or
// undefined until it has an index.html. Neither .builder nor designs may be a symlink, and
// packApp reads only regular files, so nothing outside .builder/designs is served.
export async function readDesignDraft(workspace: string) {
  const builder = join(workspace, ".builder");
  const designs = join(builder, "designs");
  let actual: string;
  try {
    actual = await realpath(designs);
  } catch (error) {
    if (hasCode(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
  if (actual !== join(await realpath(workspace), ".builder", "designs"))
    return undefined;
  const files = await packApp(builder, designs);
  const index = files["designs/index.html"];
  // The starter mockup is the designer's scaffold, not its draft; the draft begins with its first change.
  return index === undefined || index === STARTER_INDEX ? undefined : files;
}

const MAX_DESIGN_DOC_BYTES = 256 * 1024;

// A designer's draft with its DESIGN.md, keyed as a design bundle keys them, so a later designer
// can continue it; undefined until the mockup has its first change.
export async function readDesignBundle(workspace: string) {
  const files = await readDesignDraft(workspace);
  if (files === undefined) return undefined;
  const doc = await readWorkspaceText(
    workspace,
    join(".builder", "DESIGN.md"),
    MAX_DESIGN_DOC_BYTES,
  );
  if (doc === null) throw new ProjectError(409, "design_doc_too_large");
  return doc === undefined ? files : { ...files, "DESIGN.md": doc };
}

const MAX_ACCEPTANCE_BYTES = 64 * 1024;
const MAX_DEMO_ACCOUNT_BYTES = 4 * 1024;
const DEMO_ACCOUNT = "server/src/data/demo-account.json";
const utf8 = new TextDecoder("utf-8", { fatal: true });

// A regular UTF-8 file in the workspace, null when it is larger than maxBytes, or undefined while
// there is none. No directory on its way may be a symlink and the file is opened without following
// one, so nothing outside the workspace is served.
async function readWorkspaceText(
  workspace: string,
  path: string,
  maxBytes: number,
) {
  const target = join(workspace, path);
  try {
    if (
      (await realpath(dirname(target))) !==
      dirname(join(await realpath(workspace), path))
    )
      return undefined;
  } catch (error) {
    if (hasCode(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
  let file;
  try {
    file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (hasCode(error) && (error.code === "ENOENT" || error.code === "ELOOP"))
      return undefined;
    throw error;
  }
  try {
    const stat = await file.stat();
    if (!stat.isFile()) return undefined;
    if (stat.size > maxBytes) return null;
    return utf8.decode(await file.readFile());
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  } finally {
    await file.close();
  }
}

// The coder's ACCEPTANCE.md at the workspace root, or undefined until it writes one.
export async function readAcceptance(workspace: string) {
  const markdown = await readWorkspaceText(
    workspace,
    "ACCEPTANCE.md",
    MAX_ACCEPTANCE_BYTES,
  );
  if (markdown === null) throw new ProjectError(409, "acceptance_too_large");
  return markdown;
}

const MAX_STYLES_BYTES = 256 * 1024;

// Rewrites the designer's .builder/designs/styles.css where it lies, creating it when missing. The
// designs folder must be the workspace's own and the file is opened without following a symlink.
export async function editDesignStyles(
  workspace: string,
  edit: (css: string) => string,
) {
  const designs = join(workspace, ".builder", "designs");
  if (
    (await realpath(designs)) !==
    join(await realpath(workspace), ".builder", "designs")
  )
    throw new ProjectError(409, "design_workspace_unsafe");
  const path = join(".builder", DESIGN_STYLES);
  const css = await readWorkspaceText(workspace, path, MAX_STYLES_BYTES);
  if (css === null) throw new ProjectError(409, "design_styles_too_large");
  const file = await open(
    join(workspace, path),
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_TRUNC |
      constants.O_NOFOLLOW,
  );
  try {
    await file.writeFile(edit(css ?? ""));
  } finally {
    await file.close();
  }
}

const DemoAccount = type({ email: "string > 0", password: "string > 0" });

// The sign-in the app seeds from the coder starter's demo account file, or undefined without one.
export function demoLogin(files: Readonly<Record<string, string>>) {
  const text = files[DEMO_ACCOUNT];
  if (text === undefined || text.length > MAX_DEMO_ACCOUNT_BYTES)
    return undefined;
  const account = DemoAccount(parseJson(text));
  return account instanceof type.errors
    ? undefined
    : { email: account.email, password: account.password };
}

export async function readDemoLogin(workspace: string) {
  const text = await readWorkspaceText(
    workspace,
    DEMO_ACCOUNT,
    MAX_DEMO_ACCOUNT_BYTES,
  );
  return typeof text === "string"
    ? demoLogin({ [DEMO_ACCOUNT]: text })
    : undefined;
}
