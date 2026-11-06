import { type } from "arktype";
import { AppBundle } from "./artifact.ts";

// The rules for which of a workspace's or a repository's files are the app's, and how they are
// packed as an app document. The hub packs a coder's workspace with them, the UI and the import
// script pack a person's own repository with them, so the three agree on what leaves out.

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
