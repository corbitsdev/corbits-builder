import { type } from "arktype";
import { AppBundle } from "./artifact.ts";

// The rules for which of a workspace's or a repository's files are the app's, and how they are
// packed as an app document. The hub packs a coder's workspace with them, the UI and the import
// script pack a person's own repository with them, so the three agree on what leaves out.

// The response header that names the version of an app download, in the form a check reads the
// saved app's version: the commit, or v<N> for a filed version. It arrives with the files, so
// whoever publishes them knows their version without asking again.
export const APP_VERSION_HEADER = "x-builder-app-version";

// The path from the app's root of a folder or file that a build of the app may return. The caller
// chooses it, so it may not leave the app, start at the machine's root, or contain a segment the
// hub would read differently from the caller.
export const AppBuildPath = type("0 < string <= 256").narrow(
  (path, ctx) =>
    (![...path].some((char) => char === "\\" || char.charCodeAt(0) < 0x20) &&
      path
        .split("/")
        .every(
          (segment) => segment !== "" && segment !== "." && segment !== "..",
        )) ||
    ctx.mustBe(
      "a path inside the app without a leading or trailing slash, empty, . or .. segments, backslashes or control characters",
    ),
);
// A build of the saved app returns one to eight folders or files, not the whole app.
export const AppBuildPaths = AppBuildPath.array()
  .atLeastLength(1)
  .atMostLength(8);

// The codes the hub refuses a build of the saved app with when the cause is the app or its project,
// not the hub. Each comes in a 4xx response, and the caller reads only the code.
export const AppBuildRefusal = type.enumerated(
  "app_not_filed",
  "stack_production_missing",
  "invalid_stack_production",
  "app_command_running",
  "install_failed",
  "build_failed",
  "build_timed_out",
  "build_path_missing",
  "build_path_is_link",
  "build_output_too_large",
);
export type AppBuildRefusal = typeof AppBuildRefusal.infer;

// A warmed designer or coder workspace holds the filed documents it works from here.
export const INPUTS_DIRECTORY = ".inputs";

// Installs and builds are rebuilt by setup and check-app, .builder and the inputs come from filed
// documents, and .scratch holds the coder's throwaway files, such as the screenshots it takes.
export const EXCLUDED_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  ".git",
  ".builder",
  ".scratch",
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

// An app repository begins with a commit holding only a .gitignore, which a fresh workspace checks
// out, so a workspace or a repository holds an app once it holds any other path, whatever the app
// is written in.
export const holdsApp = (paths: readonly string[]) =>
  paths.some((path) => path !== ".gitignore");

// Byte-order marks stay in the text, so a file reads back exactly as it was.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

/** The bytes a string takes as UTF-8. */
export const utf8Length = (text: string) => encoder.encode(text).length;

// Base64 without Buffer, so a browser packs an app the same way the hub does.
const CHUNK = 0x8000;
export function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += CHUNK)
    binary += String.fromCharCode(...bytes.subarray(at, at + CHUNK));
  return btoa(binary);
}
export function base64Decode(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return bytes;
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
    bundle.binary[path] = base64Encode(bytes);
  }
}

// A bundle's files as they are written to disk: text as is, binaries decoded.
export function bundleFiles(bundle: {
  files: Readonly<Record<string, string>>;
  binary?: Readonly<Record<string, string>>;
}): Record<string, string | Uint8Array> {
  const files: Record<string, string | Uint8Array> = { ...bundle.files };
  if (bundle.binary)
    for (const [path, data] of Object.entries(bundle.binary))
      files[path] = base64Decode(data);
  return files;
}

// Keys in order, so the same files always make the same content and an unchanged app files nothing.
const sorted = (record: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => {
      if (a < b) return -1;
      return a > b ? 1 : 0;
    }),
  );

// Collected files as an app bundle and its document content. An app is as large as it is: a
// resource that runs out on the way, such as memory or a request body, reports its own error.
export function bundleContent(collected: Required<AppBundle>) {
  const files = sorted(collected.files);
  const binary = sorted(collected.binary);
  const bundle = AppBundle(
    Object.keys(binary).length ? { files, binary } : { files },
  );
  if (bundle instanceof type.errors)
    throw new Error("invalid_app: " + bundle.summary);
  return { bundle, content: JSON.stringify(bundle) };
}
