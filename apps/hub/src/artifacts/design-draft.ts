import { constants } from "node:fs";
import { open, readFile, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type } from "arktype";
import { workflowRunRepoIdForAddress } from "@intx/hub-sessions";
import { hasCode } from "@intx/types";
import {
  DesignDraft,
  MAX_DESIGN_BYTES,
  type UserManual,
} from "@corbits-builder/schemas/artifact";
import { packApp } from "../builds/app-snapshot.ts";
import {
  spliceDesignScreens,
  STARTER_HOME_SCREEN,
  STARTER_INDEX,
  STARTER_SPLICED_INDEX,
} from "../builds/starter.ts";
import { parseJson } from "../lib/json.ts";
import { ProjectError } from "../projects/errors.ts";
import { withDesignTokens } from "./design-tokens.ts";
import { DESIGN_STYLES } from "./design-tweaks.ts";

const hasInlineNonHomeScreen = (index: string | undefined) => {
  if (index === undefined) return false;
  for (const match of index.matchAll(/data-screen=["']([^"']+)["']/g)) {
    if (match[1] !== "home") return true;
  }
  return false;
};

// The starter's home.html stays on disk when a designer builds screens with other names; drop it
// once another screen exists while home.html is still the starter's.
export function withoutUnusedStarterHome(
  files: Record<string, string>,
): Record<string, string> {
  const screens = Object.fromEntries(
    Object.entries(files).filter(
      ([path]) => path.startsWith("designs/screens/") && path.endsWith(".html"),
    ),
  );
  const next =
    files["designs/index.html"] !== undefined && Object.keys(screens).length > 0
      ? {
          ...files,
          "designs/index.html": spliceDesignScreens(
            files["designs/index.html"],
            screens,
          ),
        }
      : files;
  const home = next["designs/screens/home.html"];
  if (home === undefined || home !== STARTER_HOME_SCREEN) return next;
  const index = next["designs/index.html"];
  const hasOtherScreen =
    Object.entries(next).some(
      ([path, content]) =>
        path.startsWith("designs/screens/") &&
        path.endsWith(".html") &&
        path !== "designs/screens/home.html" &&
        content.trim().length > 0,
    ) || hasInlineNonHomeScreen(index);
  if (!hasOtherScreen) return next;
  const { "designs/screens/home.html": _, ...rest } = next;
  return rest;
}

const isStarterPages = (files: Readonly<Record<string, string>>) => {
  const index = files["designs/index.html"];
  if (
    index === undefined ||
    (index !== STARTER_INDEX && index !== STARTER_SPLICED_INDEX)
  )
    return false;
  const otherPages = Object.keys(files).filter(
    (path) =>
      path.endsWith(".html") &&
      path !== "designs/index.html" &&
      path !== "designs/screens/home.html",
  );
  if (otherPages.length > 0) return false;
  const home = files["designs/screens/home.html"];
  return home === undefined || home === STARTER_HOME_SCREEN;
};

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
  // The starter mockup is the designer's scaffold, not its draft; the draft begins with its first change.
  if (files["designs/index.html"] === undefined || isStarterPages(files))
    return undefined;
  return withoutUnusedStarterHome(files);
}

// A designer's draft with its DESIGN.md, keyed as a design bundle keys them, so a later designer
// can continue it; undefined until the mockup has its first change.
export async function readDesignBundle(workspace: string) {
  const files = await readDesignDraft(workspace);
  if (files === undefined) return undefined;
  const doc = await readWorkspaceText(
    workspace,
    join(".builder", "DESIGN.md"),
    MAX_DESIGN_BYTES,
  );
  if (doc === null) throw new ProjectError(409, "design_doc_too_large");
  return doc === undefined ? files : { ...files, "DESIGN.md": doc };
}

// The designer's .builder folder as file_design_option files it: the screens spliced into the
// shell, the unused starter home dropped, and the tokens of styles.css written into DESIGN.md.
export async function readDesignFiles(workspace: string) {
  const files: Record<string, string> = {};
  for await (const path of new Bun.Glob("**/*").scan({
    cwd: join(workspace, ".builder"),
  }))
    files[path] = await readFile(join(workspace, ".builder", path), "utf8");
  const packed = withoutUnusedStarterHome(files);
  const doc = packed["DESIGN.md"];
  const styles = packed[DESIGN_STYLES];
  if (doc === undefined || styles === undefined)
    throw new Error(
      `invalid_design: .builder needs DESIGN.md and ${DESIGN_STYLES}`,
    );
  try {
    packed["DESIGN.md"] = withDesignTokens(doc, styles);
  } catch (error) {
    throw new Error(
      `invalid_design: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return packed;
}

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

/** A design's size as it is stored, against the limit, with its largest files named. */
export function designSize(files: Readonly<Record<string, string>>) {
  const bytes = Buffer.byteLength(JSON.stringify({ files }));
  const largest = Object.entries(files)
    .map(([path, text]) => ({ path, bytes: Buffer.byteLength(text) }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 3)
    .map((file) => `${file.path} (${kb(file.bytes)})`)
    .join(", ");
  return {
    bytes,
    over: bytes > MAX_DESIGN_BYTES,
    near: bytes > MAX_DESIGN_BYTES * 0.9,
    text: `the design is ${bytes.toLocaleString("en-US")} bytes and may be at most ${MAX_DESIGN_BYTES.toLocaleString("en-US")}; its largest files are ${largest}`,
  };
}

/**
 * A draft as the hub serves it. One over the limit is refused, saying what is largest and, when
 * given, what a designer starts from instead.
 */
export function designDraftOf(files: Record<string, string>, instead?: string) {
  const draft = DesignDraft.assert({ files });
  const size = designSize(files);
  if (size.over)
    throw new ProjectError(409, "design_draft_too_large", {
      bytes: size.bytes,
      limit: MAX_DESIGN_BYTES,
      hint: [`The draft cannot be loaded: ${size.text}.`, instead]
        .filter(Boolean)
        .join(" "),
    });
  return draft;
}

const MAX_ACCEPTANCE_BYTES = 64 * 1024;
const MAX_DEMO_ACCOUNT_BYTES = 4 * 1024;
const DEMO_ACCOUNT = "server/src/data/demo-account.json";
const utf8 = new TextDecoder("utf-8", { fatal: true });

// A regular UTF-8 file in the workspace, null when it is larger than maxBytes, or undefined while
// there is none or it is not UTF-8.
async function readWorkspaceText(
  workspace: string,
  path: string,
  maxBytes: number,
) {
  const bytes = await readWorkspaceBytes(workspace, path, maxBytes);
  if (bytes === undefined || bytes === null) return bytes;
  try {
    return utf8.decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
}

// A regular file in the workspace, null when it is larger than maxBytes, or undefined while there
// is none. No directory on its way may be a symlink and the file is opened without following one,
// so nothing outside the workspace is served.
async function readWorkspaceBytes(
  workspace: string,
  path: string,
  maxBytes: number,
): Promise<Uint8Array | null | undefined> {
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
    return await file.readFile();
  } finally {
    await file.close();
  }
}

const MAX_MANUAL_BYTES = 512 * 1024;
const MAX_PICTURE_BYTES = 4 * 1024 * 1024;
// Every picture a manual shows travels in one answer, so the whole set is bounded.
const MAX_PICTURES_BYTES = 32 * 1024 * 1024;
const PICTURE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
};
// A picture as Markdown or HTML names it, as check-app reads them.
const PICTURE_REF =
  /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<img\b[^>]*\bsrc=["']([^"']+)/g;

// The media type a picture's name says it is, or undefined for a name without a known extension.
const pictureType = (ref: string): string | undefined => {
  const dot = ref.lastIndexOf(".");
  if (dot === -1) return undefined;
  return PICTURE_TYPES[ref.slice(dot + 1).toLowerCase()];
};

/** The pictures a manual shows under docs/manual/, as it names them: "manual/home.png". */
export function manualPictureRefs(markdown: string): string[] {
  const refs = new Set<string>();
  for (const [, link, img] of markdown.matchAll(PICTURE_REF)) {
    // One alternative matched: the Markdown link or the img src.
    const raw = link ?? img;
    if (raw === undefined) continue;
    const ref = decodeURIComponent(raw);
    if (ref.startsWith("manual/") && !ref.split("/").includes(".."))
      refs.add(ref);
  }
  return [...refs];
}

/** The manual's pictures as data URLs, keyed as it names them, from wherever their bytes are kept. */
export function manualPictures(
  markdown: string,
  bytesOf: (ref: string) => Uint8Array | undefined,
): Record<string, string> {
  const pictures: Record<string, string> = {};
  let total = 0;
  for (const ref of manualPictureRefs(markdown)) {
    const type = pictureType(ref);
    const bytes = bytesOf(ref);
    if (type === undefined || bytes === undefined) continue;
    total += bytes.byteLength;
    if (total > MAX_PICTURES_BYTES) break;
    pictures[ref] =
      `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  }
  return pictures;
}

// The coder's docs/USER-MANUAL.md with the pictures it shows, or undefined until it writes one.
export async function readUserManual(
  workspace: string,
): Promise<UserManual | undefined> {
  const markdown = await readWorkspaceText(
    workspace,
    join("docs", "USER-MANUAL.md"),
    MAX_MANUAL_BYTES,
  );
  if (markdown === null) throw new ProjectError(409, "manual_too_large");
  if (markdown === undefined) return undefined;
  const read = new Map<string, Uint8Array>();
  for (const ref of manualPictureRefs(markdown)) {
    const bytes = await readWorkspaceBytes(
      workspace,
      join("docs", ref),
      MAX_PICTURE_BYTES,
    );
    if (bytes !== undefined && bytes !== null) read.set(ref, bytes);
  }
  return {
    markdown,
    pictures: manualPictures(markdown, (ref) => read.get(ref)),
  };
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
  const css = await readWorkspaceText(workspace, path, MAX_DESIGN_BYTES);
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
