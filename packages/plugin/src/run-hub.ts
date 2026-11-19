import { HUB_CREDENTIAL_HANDLE } from "@intx/types/credential-delivery";
import type { RuntimeCapabilities } from "@intx/types/runtime-capabilities";
import { ProjectValues } from "@corbits-builder/schemas/artifact";
import { workflowHttpJson } from "./http-json.ts";
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
};

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
  const json = async (suffix: string, body?: unknown) =>
    workflowHttpJson({
      capabilities,
      handle: HUB_CREDENTIAL_HANDLE,
      path: (await projectPath()) + suffix,
      ...(body === undefined ? {} : { body }),
      maxResponseBytes: MAX_JSON_BYTES,
      signal,
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
  };
}
