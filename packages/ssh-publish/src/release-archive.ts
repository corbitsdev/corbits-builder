import type { AppFiles } from "@corbits-builder/plugin/run-hub";
import { sha256 } from "./runtime.ts";

/** The saved app's files as a tar archive of plain files, by their paths from the app's root. */
export async function appTar(files: AppFiles["files"]) {
  return new Uint8Array(
    await new Bun.Archive(Object.fromEntries(files)).bytes(),
  );
}

const versionPart = (version: string) =>
  version.replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "app";

/** The production settings the release script applies: how the app installs, builds and starts. */
export type Production = {
  readonly install: string;
  readonly build: string;
  readonly start: string;
  readonly port: string;
  readonly data: readonly string[];
};

// The release script applies the production settings along with the code, so a release of the same
// version with other settings is another release. The digest has a fixed length, so the version part
// before it is unambiguous.
const settingsPart = ({ install, build, start, port, data }: Production) =>
  sha256(
    new TextEncoder().encode(
      JSON.stringify([install, build, start, port, data]),
    ),
  ).slice(0, 12);

const releasePart = (version: string, production: Production) =>
  versionPart(version) + settingsPart(production);

// A release id: the time it went out, to the millisecond, then its app version and a digest of its
// production settings. Ids sort by time, and two releases of one version never share an id.
export function releaseId(at: Date, version: string, production: Production) {
  const time = at.toISOString().replace(/\D/g, "").slice(0, 17);
  return `${time}-${releasePart(version, production)}`;
}

/**
 * Whether the release with this id, as releaseId makes it, holds this version of the app with these
 * production settings.
 */
export const isReleaseOf = (
  id: string,
  version: string,
  production: Production,
) => /^\d{17}-/.test(id) && id.slice(18) === releasePart(version, production);
