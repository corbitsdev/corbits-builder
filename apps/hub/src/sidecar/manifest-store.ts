import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { type } from "arktype";
import { errorText } from "./error-text.ts";
import { hasCode, type CredentialCipher } from "@intx/types";

const LocalSidecarManifestSchema = type({
  sidecarId: "string",
  hubWebSocketUrl: "string",
  dataDir: "string",
  token: "string",
});
/** The hub's one local sidecar: the identity it authenticates with and where it keeps its state. */
export type LocalSidecarManifest = typeof LocalSidecarManifestSchema.infer;

/** An allocation the sidecar hosts, at the generation and under the identity the hub offered for it. */
const LocalSidecarHold = type({
  allocationId: "string > 0",
  generation: "number.integer >= 0",
  offeredSidecarId: "string > 0",
});
export type LocalSidecarHold = typeof LocalSidecarHold.infer;
const LocalSidecarHolds = LocalSidecarHold.array();

export interface LocalSidecarManifestStore {
  read(): Promise<LocalSidecarManifest | null>;
  write(manifest: LocalSidecarManifest): Promise<void>;
  remove(): Promise<void>;
  readHolds(): Promise<LocalSidecarHold[]>;
  writeHolds(holds: readonly LocalSidecarHold[]): Promise<void>;
  /** The pid of the sidecar process last started on this data root, or null when none is recorded. */
  readPid(): Promise<number | null>;
  writePid(pid: number): Promise<void>;
  removePid(): Promise<void>;
}

type CreateLocalSidecarManifestStoreOpts = {
  readonly dataRoot: string;
  readonly cipher: CredentialCipher;
  readonly log: (entry: Record<string, unknown>) => void;
};

/** Domain-separated from `credentialAad` so a manifest token never decrypts as a credential secret. */
function manifestTokenAad(sidecarId: string): string {
  return JSON.stringify(["sidecar-manifest-token", sidecarId]);
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (hasCode(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeAtomically(target: string, text: string): Promise<void> {
  const temp = `${target}.${randomBytes(6).toString("hex")}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.writeFile(temp, text, { mode: 0o600 });
    await fs.rename(temp, target);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
}

export function createLocalSidecarManifestStore({
  dataRoot,
  cipher,
  log,
}: CreateLocalSidecarManifestStoreOpts): LocalSidecarManifestStore {
  const manifestFile = path.join(dataRoot, "sidecar.json");
  const holdsFile = path.join(dataRoot, "holds.json");
  const pidFile = path.join(dataRoot, "sidecar.pid");

  async function write(manifest: LocalSidecarManifest): Promise<void> {
    const stored = {
      ...manifest,
      token: await cipher.encrypt(
        manifest.token,
        manifestTokenAad(manifest.sidecarId),
      ),
    };
    await writeAtomically(manifestFile, JSON.stringify(stored));
  }

  // An unreadable manifest names no sidecar that can be respawned.
  async function read(): Promise<LocalSidecarManifest | null> {
    const text = await readOptional(manifestFile);
    if (text === null) return null;
    try {
      const stored = LocalSidecarManifestSchema.assert(JSON.parse(text));
      return {
        ...stored,
        token: await cipher.decrypt(
          stored.token,
          manifestTokenAad(stored.sidecarId),
        ),
      };
    } catch (error) {
      await fs.rm(manifestFile, { force: true });
      log({
        level: "warn",
        msg: "local_sidecar_manifest_unreadable_removed",
        file: manifestFile,
        error: errorText(error),
      });
      return null;
    }
  }

  async function remove(): Promise<void> {
    await fs.rm(manifestFile, { force: true });
  }

  // An unreadable holds file names nothing restore can bring back; the hub places that work again.
  async function readHolds(): Promise<LocalSidecarHold[]> {
    const text = await readOptional(holdsFile);
    if (text === null) return [];
    try {
      return LocalSidecarHolds.assert(JSON.parse(text));
    } catch (error) {
      await fs.rm(holdsFile, { force: true });
      log({
        level: "warn",
        msg: "local_sidecar_holds_unreadable_removed",
        file: holdsFile,
        error: errorText(error),
      });
      return [];
    }
  }

  async function writeHolds(holds: readonly LocalSidecarHold[]): Promise<void> {
    await writeAtomically(holdsFile, JSON.stringify(holds));
  }

  async function readPid(): Promise<number | null> {
    const pid = Number((await readOptional(pidFile))?.trim());
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  }

  async function writePid(pid: number): Promise<void> {
    await writeAtomically(pidFile, String(pid));
  }

  async function removePid(): Promise<void> {
    await fs.rm(pidFile, { force: true });
  }

  return {
    read,
    write,
    remove,
    readHolds,
    writeHolds,
    readPid,
    writePid,
    removePid,
  };
}
