import { type } from "arktype";
import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { ProjectValues } from "@corbits-builder/schemas/artifact";
import {
  ServerKeyRefusalCode,
  ServerKeyRevoked,
  ServerKeyState,
  type ServerKeyBind,
} from "@corbits-builder/schemas/settings";
import { WorkflowHttpError, workflowHttpJson } from "./http-json.ts";
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

/** What a publish tool needs of the hub, through the run's credential. */
export type RunHub = {
  projectId(): Promise<string>;
  // Only the values the run's action reads, the only ones a run may read.
  values(names: readonly string[]): Promise<Readonly<Record<string, unknown>>>;
  // Saves project values the run's action writes, null clearing one.
  record(values: Readonly<Record<string, unknown>>): Promise<void>;
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

// A bind waits on the hub's sign-in to the server, which may take up to 20 s to give up on a server
// that is still starting. The call gets well over that before it counts as the hub not answering.
const BIND_TIMEOUT_MS = 45_000;

const MAX_JSON_BYTES = 65_536;

/**
 * The hub as a publish tool's run reaches it, through the run's hub credential. Every call that
 * fails throws BuilderUnavailable, unless the run was cancelled; then it throws what the call
 * threw.
 */
export function runHub(
  capabilities: RuntimeCapabilities,
  role: string,
  signal: AbortSignal,
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
  };
}
