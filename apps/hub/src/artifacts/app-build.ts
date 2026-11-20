import { type } from "arktype";
import type { DB } from "@intx/db";
import { getLogger } from "@intx/log";
import { declaredProduction } from "@corbits-builder/plugin";
import {
  AppBuildPaths,
  type AppBuildRefusal,
} from "@corbits-builder/schemas/app-files";
import type { SandboxToolchains } from "@corbits-builder/schemas/installed-workflows";
import { opensNetwork } from "../config/preferences.ts";
import type { Actor } from "../lib/actor.ts";
import {
  COMMAND_BUSY,
  COMMAND_CANCELLED,
  type createCommandRunner,
} from "../plugins/command-runner.ts";
import { ProjectError } from "../projects/errors.ts";
import { loadSettings } from "../settings/policy.ts";
import { projectValueStore, readStoredValues } from "../values/store.ts";
import { savedAppVersion, type createArtifactService } from "./service.ts";

const log = getLogger(["corbits-builder", "hub", "app-build"]);

// Covers a cold install of a web app's packages, with nothing cached in the fresh sandbox's home,
// plus its build. The run that asks lives ten minutes. It may already have waited 90 s for the
// project's command slot and spend about three minutes on its own work after the build. So the
// build gives up well inside that, and the run still gets build_timed_out. The starter builds take
// under two minutes.
export const APP_BUILD_TIMEOUT_MS = 5 * 60_000;
// The most one build may return, before compression. That fits a static site with its assets or a
// worker bundle with room to spare, and is as much as the hub can comfortably keep in memory per
// request.
export const APP_BUILD_MAX_FILES = 10_000;
export const APP_BUILD_MAX_BYTES = 100 * 1024 * 1024;

// A refusal whose code is all the caller sees, typed so it stays one of the codes the route names.
const refused = (
  status: 404 | 409 | 422,
  code: AppBuildRefusal,
  details?: ConstructorParameters<typeof ProjectError>[2],
) => new ProjectError(status, code, details);

/**
 * Builds a project's saved app as it is built for production, in the sandbox the checks use, and
 * returns the paths asked for. The commands are the project's own stack.production install and
 * build, never the caller's. Nothing the build prints reaches the caller: a failure is a fixed
 * code, and the tail of the output is logged at debug for an operator. The app's author controls
 * that output, and the caller is a tool whose results reach a model.
 */
export function createAppBuilds(deps: {
  db: DB["db"];
  artifacts: ReturnType<typeof createArtifactService>;
  commands: ReturnType<typeof createCommandRunner>;
  // The toolchain folders every build sandbox reads, from the hub's environment.
  toolchains: SandboxToolchains;
}) {
  return {
    async build(
      actor: Actor,
      projectId: string,
      requested: unknown,
      signal: AbortSignal,
    ) {
      const paths = AppBuildPaths(requested);
      if (paths instanceof type.errors)
        throw new ProjectError(400, "invalid_build_paths", { issues: paths });
      const app = await deps.artifacts.appToBuild(actor, projectId);
      if (!app) throw refused(404, "app_not_filed");
      const production = declaredProduction(
        await readStoredValues(
          projectValueStore(deps.db, actor.tenantId, projectId),
        ),
      );
      if (!production) throw refused(409, "stack_production_missing");
      if (production instanceof type.errors)
        throw refused(409, "invalid_stack_production", {
          issues: production,
        });
      const { preferences } = await loadSettings(
        deps.db,
        actor.tenantId,
        projectId,
      );
      const ran = await deps.commands.run(
        projectId,
        {
          bundle: app.bundle,
          command: { lines: [production.install, production.build] },
          timeoutMs: APP_BUILD_TIMEOUT_MS,
          openNetwork: opensNetwork(preferences.value),
          toolchains: deps.toolchains,
        },
        {
          paths,
          maxFiles: APP_BUILD_MAX_FILES,
          maxBytes: APP_BUILD_MAX_BYTES,
        },
        signal,
      );
      if ("error" in ran) {
        if (ran.error === COMMAND_BUSY)
          throw refused(409, "app_command_running");
        // The caller went away, so no one reads the answer.
        if (ran.error === COMMAND_CANCELLED)
          throw new ProjectError(503, "app_build_unavailable");
        log.error("An app build could not run: {error}", {
          projectId,
          error: ran.error,
        });
        throw new ProjectError(503, "app_build_unavailable");
      }
      if (ran.timedOut || ran.exitCode !== 0) {
        log.warn("An app build failed", {
          projectId,
          step: ran.step,
          exitCode: ran.exitCode,
          timedOut: ran.timedOut,
        });
        log.debug("An app build's output", { projectId, output: ran.output });
        if (ran.timedOut) throw refused(422, "build_timed_out");
        throw refused(422, ran.step === 0 ? "install_failed" : "build_failed");
      }
      const { exported, archive } = ran;
      if (exported && "missing" in exported)
        throw refused(422, "build_path_missing", {
          path: exported.missing,
        });
      if (exported && "link" in exported)
        throw refused(422, "build_path_is_link", {
          path: exported.link,
        });
      if (exported && "tooLarge" in exported)
        throw refused(422, "build_output_too_large", {
          maxFiles: APP_BUILD_MAX_FILES,
          maxBytes: APP_BUILD_MAX_BYTES,
        });
      if (!archive) throw new Error("an app build exported no archive");
      return { version: savedAppVersion(app), archive };
    },
  };
}
export type AppBuilds = ReturnType<typeof createAppBuilds>;
