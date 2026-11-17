import { type } from "arktype";
import type { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import type { TenantEnv } from "@intx/hub-api";
import {
  ProjectValues,
  ProjectValuesWrite,
} from "@corbits-builder/schemas/artifact";
import { actorOf } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import { CATALOG, catalogOf, isWorkflowAction } from "../plugins/catalog.ts";
import type { createArtifactService } from "../artifacts/service.ts";
import { body, security } from "../http/route-parts.ts";
import { saveValues, undeclaredValue } from "./save.ts";
import { projectValueWrites, readProjectValues } from "./project-values.ts";
import type { createValueService } from "./service.ts";

// Why a run may not save a value, with the names it may save as they are spelled. A specialist
// that wrote stack_language for stack.language resent it until it was stopped as a loop.
function notWritten(name: string, action: string, writes: readonly string[]) {
  const loose = (each: string) => each.toLowerCase().replace(/[^a-z0-9]/g, "");
  const meant = writes.find((each) => loose(each) === loose(name));
  const named = writes.map((each) => `\`${each}\``).join(", ");
  const saves =
    writes.length > 0 ? `It saves only ${named}.` : "It saves no values.";
  return meant === undefined
    ? `is not a value ${action} saves. ${saves}`
    : `is not a value ${action} saves; did you mean \`${meant}\`? ${saves}`;
}

export function mountValueRoutes(
  app: Hono<TenantEnv>,
  service: ReturnType<typeof createValueService>,
  artifacts: ReturnType<typeof createArtifactService>,
  nativeFetch?: (request: Request) => Promise<Response>,
) {
  app.post(
    "/:projectId/run-values",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "saveRunValues",
      description:
        "A specialist run saves project values it learned: only those the plugin action it was started for writes, each checked against its declared type and stored as the values route stores it. Returns the saved values read back.",
      security,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: resolver(ProjectValuesWrite) },
        },
      },
      responses: {
        200: {
          description: "Each saved value as now stored",
          content: { "application/json": { schema: resolver(ProjectValues) } },
        },
        400: { description: "A value its type refuses" },
        403: {
          description:
            "A value the run's action does not write, named with the values it does",
        },
      },
    }),
    async (c) => {
      const current = actorOf(c);
      const projectId = c.req.param("projectId");
      const input = ProjectValuesWrite(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_project_values", {
          issues: input,
        });
      const run = await artifacts.valuesRun(current, projectId);
      const catalog = await catalogOf(
        artifacts.projectState,
        current,
        projectId,
      );
      const action = catalog.actions
        .filter(isWorkflowAction)
        .find(
          (installed) =>
            installed.plugin === run.plugin && installed.action === run.action,
        );
      if (!action) throw new ProjectError(403, "run_value_not_written");
      const { writes } = action.builder;
      const refused = Object.keys(input.values).filter(
        (name) => !writes.includes(name),
      );
      if (refused.length > 0)
        throw new ProjectError(403, "run_value_not_written", {
          issues: refused.map((name) => ({
            path: name,
            message: notWritten(name, `${run.plugin} ${run.action}`, writes),
          })),
        });
      // Refuses a value its declared type does not take. Every value an action writes is one a
      // plugin declares, kept in the plain store, so the values are stored as they came.
      projectValueWrites(
        input.values,
        await artifacts.projectState(current, projectId),
        CATALOG.values,
      );
      await service.saveRunValues(current, projectId, input.values);
      return c.json({
        values: readProjectValues(
          Object.keys(input.values),
          await artifacts.projectState(current, projectId),
          CATALOG.values,
        ),
      });
    },
  );
  app.post(
    "/:projectId/values",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "saveProjectValues",
      description:
        "Saves project values by name, each checked against its declared type and written to its home. Once a design is filed, a value its plugin keeps in the design's styles becomes that design token, leading any list the token holds, written as design-tweaks writes them. Before that, and for every other value, they go to the project's own store. Returns the saved values read back.",
      security,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: resolver(ProjectValuesWrite) },
        },
      },
      responses: {
        200: {
          description: "Each saved value as now stored",
          content: { "application/json": { schema: resolver(ProjectValues) } },
        },
        400: {
          description:
            "A name that no plugin declares or a value its type refuses",
        },
      },
    }),
    async (c) => {
      const current = actorOf(c);
      const projectId = c.req.param("projectId");
      const input = ProjectValuesWrite(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_project_values", {
          issues: input,
        });
      await saveValues(
        c,
        projectId,
        input.values,
        artifacts,
        service,
        nativeFetch,
      );
      const state = await artifacts.projectState(current, projectId);
      return c.json({
        values: readProjectValues(
          Object.keys(input.values),
          state,
          CATALOG.values,
        ),
      });
    },
  );
  app.get(
    "/:projectId/values",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "readProjectValues",
      description:
        "The project values named in keys, comma separated, each read from its home: a value its plugin keeps in the design's styles from the filed design's styles.css once a design is filed, and before that, like every other declared value, from the project's own store. A value the project has none of yet is null.",
      security,
      responses: {
        200: {
          description: "Each named value, or null",
          content: { "application/json": { schema: resolver(ProjectValues) } },
        },
        400: { description: "No keys, or a key that no plugin declares" },
      },
    }),
    async (c) => {
      const keys = c.req.query("keys");
      if (keys === undefined)
        throw new ProjectError(400, "project_value_keys_required");
      const names = keys.split(",");
      const unknown = undeclaredValue(names);
      if (unknown !== undefined)
        throw new ProjectError(400, "unknown_project_value", { key: unknown });
      const state = await artifacts.projectState(
        actorOf(c),
        c.req.param("projectId"),
      );
      return c.json({
        values: readProjectValues(names, state, CATALOG.values),
      });
    },
  );
}
