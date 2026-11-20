import { type } from "arktype";
import { unzip, ZipError } from "@corbits/zip";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import {
  APP_VERSION_HEADER,
  AppBuildRefusal,
} from "@corbits-builder/schemas/app-files";
import { ProjectValues } from "@corbits-builder/schemas/artifact";
import {
  ServerKeyRefusalCode,
  ServerKeyRevoked,
  ServerKeyState,
  type ServerKeyBind,
} from "@corbits-builder/schemas/settings";
import {
  cappedBody,
  waitFor,
  WorkflowHttpError,
  workflowHttpJson,
} from "./http-json.ts";
import { resolveWorkflowProjectScope } from "./project-scope.ts";

/**
 * A tool's call to Builder's hub that failed, for any reason. Its status and message stay out of
 * the tool's answer, because they are Builder's and say nothing about the place the app is
 * published to.
 */
export class BuilderUnavailable extends Error {
  constructor(options?: ErrorOptions) {
    super("builder_unavailable", options);
    this.name = "BuilderUnavailable";
  }
}

/** The saved app's files by their path from the app's root, and the version they hold. */
export type AppFiles = {
  // As a check reads the saved app's version: its commit, or v<N> for a filed version.
  version: string;
  files: ReadonlyMap<string, Uint8Array>;
};

/** What a publish tool needs of the hub, through the run's credential. */
export type RunHub = {
  projectId(): Promise<string>;
  // Only the values the run's action reads, the only ones a run may read.
  values(names: readonly string[]): Promise<Readonly<Record<string, unknown>>>;
  // Saves project values the run's action writes, null clearing one.
  record(values: Readonly<Record<string, unknown>>): Promise<void>;
  // The saved app's source; undefined while the project has none.
  source(): Promise<AppFiles | undefined>;
  // The saved app built for production, only the paths named, or the hub's refusal of the build. A
  // build refused only because the project's checks are running is asked again for a while first.
  build(
    paths: readonly string[],
  ): Promise<AppFiles | { refused: AppBuildRefusal }>;
  // The server key the run's action provisions under name, or why the hub refuses it. The hub makes
  // the key on the first ask and answers with the same key and label after that.
  serverKey(
    name: string,
  ): Promise<ServerKeyState | { refused: ServerKeyRefusalCode }>;
  // What serverKey answers, but without the hub making a key: undefined while none was asked for.
  heldServerKey(
    name: string,
  ): Promise<ServerKeyState | { refused: ServerKeyRefusalCode } | undefined>;
  // Has the hub sign in to the server with the issued key, pinned to its host key, and save it as
  // the credential once that works. The server_ refusals may pass once the server is up.
  bindServerKey(
    name: string,
    server: ServerKeyBind,
  ): Promise<ServerKeyState | { refused: ServerKeyRefusalCode }>;
  // Forgets the key the run's plugin made under name and revokes the credential it became.
  revokeServerKey(name: string): Promise<ServerKeyRevoked>;
};

/** The clock a run's waits read and sleep with; a test passes its own. */
export type Clock = { now(): number; sleep(ms: number): Promise<void> };

const realClock: Clock = {
  now: () => performance.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// How long to keep asking, from when (by default, from when the wait is made), and how often.
export type WaitWindow = { withinMs: number; everyMs: number; from?: number };

/**
 * Whether to ask again after a not-yet answer. While less than withinMs has passed since from, it
 * sleeps everyMs and answers true; after that it answers false. A cancelled run ends the sleep at
 * once and throws as a cancelled call does.
 */
export function waitingWithin(
  clock: Clock,
  signal: AbortSignal,
  { withinMs, everyMs, from = clock.now() }: WaitWindow,
): () => Promise<boolean> {
  return async () => {
    if (clock.now() - from >= withinMs) return false;
    await waitFor(clock.sleep, everyMs, signal);
    return true;
  };
}

// A save starts its checks, and they take the project's only command slot, so a publish started
// right after a save finds the build refused as busy. In recorded runs the builds check took 12 to
// 21 s from the save, and a save can start more than one command check in turn; 90 s waits out
// several. A release may also wait three minutes on the place it publishes to and then up to five
// for its build. With this wait it still fits the run's ten minutes, with little to spare.
const BUSY_WAIT: WaitWindow = { withinMs: 90_000, everyMs: 3_000 };

// A bind waits on the hub's sign-in to the server, which may take up to 20 s to give up on a server
// that is still starting. The call gets well over that before it counts as the hub not answering.
const BIND_TIMEOUT_MS = 45_000;

// The most a download from the hub may be, compressed: a saved app with its assets, or a build.
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
// How long one download from the hub may take, its body included. A build sends nothing until the
// hub's build ends, and the hub gives up on that after five minutes; the two extra minutes cover the
// transfer. The run still gives up on a hub that stops answering before its ten minutes end.
const DOWNLOAD_MS = 7 * 60_000;
const MAX_JSON_BYTES = 65_536;

// unzip refuses a path that climbs out or starts at the root. A publish also refuses one with an
// empty or . segment, which two readers could resolve to different files.
const plainPath = (path: string) =>
  path.split("/").every((part) => part !== "" && part !== ".");

/**
 * The files of a zip the hub made. With topFolder, it strips the single folder a saved app's zip
 * puts them under. The hub zips only plain files and folders under plain paths, so a zip with
 * anything else, or one that cannot be read, is Builder's fault and never reaches a publish.
 */
export async function hubZipFiles(
  zip: Uint8Array<ArrayBuffer>,
  topFolder: boolean,
): Promise<Map<string, Uint8Array>> {
  let entries;
  try {
    entries = await unzip(zip, {
      maxTotalBytes: MAX_ARCHIVE_BYTES,
      plainOnly: true,
    });
  } catch (error) {
    if (error instanceof ZipError)
      throw new BuilderUnavailable({ cause: error });
    throw error;
  }
  const files = new Map<string, Uint8Array>();
  for (const { path, data } of entries) {
    if (path.endsWith("/")) continue;
    const inside = topFolder ? path.split("/").slice(1).join("/") : path;
    if (!plainPath(inside)) throw new BuilderUnavailable();
    files.set(inside, data);
  }
  return files;
}

// Of a build's refusal only its fixed code is read.
const Refusal = type({ code: AppBuildRefusal, "+": "ignore" });

/**
 * The hub as a publish tool's run reaches it, through the run's hub credential. Every call that
 * fails throws BuilderUnavailable, unless the run was cancelled; then it throws what the call
 * threw.
 */
export function runHub(
  capabilities: RuntimeCapabilities,
  role: string,
  signal: AbortSignal,
  clock: Clock = realClock,
): RunHub {
  let scoped: ReturnType<typeof resolveWorkflowProjectScope> | undefined;
  const scope = () =>
    (scoped ??= resolveWorkflowProjectScope(capabilities, role, signal));
  const projectPath = async () => {
    const { tenantId, projectId } = await scope();
    return `/api/tenants/${encodeURIComponent(tenantId)}/projects/${encodeURIComponent(projectId)}`;
  };
  const json = async (
    suffix: string,
    body?: unknown,
    call: { timeoutMs?: number } = {},
  ) =>
    workflowHttpJson({
      capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path: (await projectPath()) + suffix,
      ...(body === undefined ? {} : { body }),
      maxResponseBytes: MAX_JSON_BYTES,
      signal,
      ...call,
    });
  const hub = async <T>(call: () => Promise<T>) => {
    try {
      return await call();
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof BuilderUnavailable) throw error;
      throw new BuilderUnavailable({ cause: error });
    }
  };
  const download = async (suffix: string) => {
    const credential = await capabilities
      .resolve("credentials")
      .resolve(HUB_CREDENTIAL_HANDLE);
    if (credential.kind !== "http")
      throw new WorkflowHttpError(undefined, "credential_kind");
    return credential.fetch((await projectPath()) + suffix, {
      credentials: "omit",
      signal: AbortSignal.any([signal, AbortSignal.timeout(DOWNLOAD_MS)]),
    });
  };
  const versioned = async (response: Response, topFolder: boolean) => {
    const version = response.headers.get(APP_VERSION_HEADER);
    if (version === null) {
      await response.body?.cancel();
      throw new Error(`app_archive_unversioned: no ${APP_VERSION_HEADER}`);
    }
    const zip = await cappedBody(response, MAX_ARCHIVE_BYTES);
    return { version, files: await hubZipFiles(zip, topFolder) };
  };
  const buildOnce = (paths: readonly string[]) =>
    hub(async (): Promise<AppFiles | { refused: AppBuildRefusal }> => {
      const query = new URLSearchParams(
        paths.map((path): [string, string] => ["path", path]),
      );
      const response = await download(`/app/build-archive?${query}`);
      if (response.ok) return versioned(response, false);
      let body: unknown;
      try {
        body = JSON.parse(
          new TextDecoder().decode(await cappedBody(response, MAX_JSON_BYTES)),
        );
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      const refusal = Refusal(body);
      if (response.status < 500 && !(refusal instanceof type.errors))
        return { refused: refusal.code };
      throw new WorkflowHttpError(response.status);
    });
  const serverKeyPath = (name: string, step: "key" | "bind" | "revoke") =>
    `/run-credentials/${encodeURIComponent(name)}/${step}`;
  // A server key refusal is the hub's fixed answer for the tool to act on; any other is Builder's.
  const serverKeyCall = (call: () => Promise<unknown>) =>
    hub(
      async (): Promise<ServerKeyState | { refused: ServerKeyRefusalCode }> => {
        try {
          return ServerKeyState.assert(await call());
        } catch (error) {
          if (!(error instanceof WorkflowHttpError)) throw error;
          const code = ServerKeyRefusalCode(error.refusalCode);
          if (code instanceof type.errors) throw error;
          return { refused: code };
        }
      },
    );
  return {
    projectId: () => hub(async () => (await scope()).projectId),
    values: (names) =>
      hub(
        async () =>
          ProjectValues.assert(
            await json(
              `/run-values?${new URLSearchParams({ keys: names.join(",") })}`,
            ),
          ).values,
      ),
    record: (values) =>
      hub(async () => {
        await json("/run-values", { values });
      }),
    source: () =>
      hub(async () => {
        const response = await download("/app/archive");
        if (response.status === 404) {
          await response.body?.cancel();
          return undefined;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new WorkflowHttpError(response.status);
        }
        // The hub's zip of a saved app puts its files under one folder named after the project.
        return versioned(response, true);
      }),
    serverKey: (name) =>
      serverKeyCall(() => json(serverKeyPath(name, "key"), {})),
    heldServerKey: async (name) => {
      const held = await serverKeyCall(() => json(serverKeyPath(name, "key")));
      return "refused" in held && held.refused === "server_key_not_issued"
        ? undefined
        : held;
    },
    bindServerKey: (name, server) =>
      serverKeyCall(() =>
        json(serverKeyPath(name, "bind"), server, {
          timeoutMs: BIND_TIMEOUT_MS,
        }),
      ),
    revokeServerKey: (name) =>
      hub(async () =>
        ServerKeyRevoked.assert(await json(serverKeyPath(name, "revoke"), {})),
      ),
    // The hub refuses a second command for a project instead of queueing it, so no request holds
    // its runner or stays open waiting. The wait happens here, between short asks.
    build: async (paths) => {
      const busy = waitingWithin(clock, signal, BUSY_WAIT);
      for (;;) {
        const built = await buildOnce(paths);
        if (
          !("refused" in built) ||
          built.refused !== "app_command_running" ||
          !(await busy())
        )
          return built;
      }
    },
  };
}
