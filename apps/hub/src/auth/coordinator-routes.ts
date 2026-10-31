import { resolveProjectTenant } from "../projects/authorization.ts";
import { mountAgentTokens, mountRunScopedTokens } from "@corbits/agent-token";
import { createGrantStore, type createDB } from "@intx/db";
import {
  createRequireGrant,
  HUB_CONDITION_REGISTRY,
  requireAuth,
  createResolveTenant,
  type TenantEnv,
} from "@intx/hub-api";
import { parseRunAddress } from "@intx/types/agent-address";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { describeRoute, resolver } from "hono-openapi";
import {
  BindCoordinator,
  CoordinatorBindingReceipt,
} from "@corbits-builder/schemas/coordinator";
import { ProjectError, projectResource } from "../projects/errors.ts";
import { createCoordinatorRegistry } from "./coordinator-registry.ts";

export function createCoordinatorRoutes(db: ReturnType<typeof createDB>["db"]) {
  const registry = createCoordinatorRegistry(db);
  const app = new Hono<TenantEnv>();
  const requireGrant = createRequireGrant({
    grantStore: createGrantStore(db),
    conditionRegistry: HUB_CONDITION_REGISTRY,
  });
  app.use("*", requireAuth, createResolveTenant({ db }));
  app.use("/:projectId/*", resolveProjectTenant(db));
  app.use("*", async (c, next) => {
    c.header("cache-control", "no-store");
    await next();
  });
  app.use(
    "*",
    bodyLimit({
      maxSize: 4096,
      onError: (c) => c.json({ error: "request_too_large" }, 413),
    }),
  );
  app.post(
    "/:projectId/coordinator",
    describeRoute({
      operationId: "bindProjectCoordinator",
      tags: ["Coordinator"],
      security: [{ sessionCookie: [] }, { deviceBearer: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(BindCoordinator) } },
      },
      responses: {
        200: {
          description:
            "Protected native coordinator binding, revision and replay receipt",
          content: {
            "application/json": { schema: resolver(CoordinatorBindingReceipt) },
          },
        },
        400: { description: "Invalid binding" },
        403: {
          description: "User/project/credential/workflow authority required",
        },
        404: { description: "Project unavailable" },
        409: {
          description:
            "Revision, replay, live native coordinator or ownership conflict",
        },
      },
    }),
    async (c) => {
      try {
        if (
          !/^application\/json(?:\s*;|$)/i.test(
            c.req.header("content-type") ?? "",
          )
        )
          return c.json({ error: "json_content_type_required" }, 415);
        const body = await c.req.json().catch(() => undefined);
        const result = await registry.bind(
          {
            tenantId: c.get("tenant").id,
            principalId: c.get("principal").id,
          },
          c.req.param("projectId"),
          body,
        );
        return c.body(result, 200, { "content-type": "application/json" });
      } catch (error) {
        if (error instanceof ProjectError)
          return c.json({ code: error.code }, error.status);
        throw error;
      }
    },
  );
  const tokens = new Hono<TenantEnv>();
  const resolveAddress = async (address: string) => {
    const parsed = parseRunAddress(address);
    if (!parsed) return null;
    const binding = await registry.boundRun(parsed.runId);
    return binding && binding.run.address === address ? binding : null;
  };
  tokens.use(
    "/workflow-run-tokens",
    describeRoute({
      operationId: "mintCoordinatorToken",
      tags: ["Coordinator"],
      security: [{ sessionCookie: [] }, { deviceBearer: [] }],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["runAddress"],
              properties: {
                runAddress: { type: "string", minLength: 1, maxLength: 256 },
                name: { type: "string", minLength: 1, maxLength: 256 },
              },
            },
          },
        },
      },
      responses: {
        201: {
          description:
            "Native Corbits run-bound token shown once; retain as a credential, never agent context",
        },
        400: { description: "Invalid body" },
        403: { description: "Project and credential authority required" },
        404: {
          description:
            "Address does not name this project's current coordinator",
        },
      },
    }),
  );
  mountRunScopedTokens(tokens, {
    db,
    requireGrant: async (c, next) =>
      requireGrant("credential:*", "create")(c, async () => {
        const projectId = c.req.param("projectId");
        if (!projectId) {
          c.res = c.json({ error: "not_found" }, 404);
          return;
        }
        const result = await requireGrant(projectResource(projectId), "manage")(
          c,
          async () => {
            const body = await c.req.json().catch(() => undefined);
            if (typeof body?.runAddress !== "string") {
              await next();
              return;
            }
            const binding = await resolveAddress(body.runAddress);
            if (
              !binding ||
              binding.projectId !== projectId ||
              binding.run.tenantId !== c.get("tenant").id
            ) {
              c.res = c.json({ error: "not_found" }, 404);
              return;
            }
            await next();
          },
        );
        if (result) c.res = result;
      }),
    resolveRun: async (address) => {
      const binding = await resolveAddress(address);
      return binding
        ? {
            tenantId: binding.run.tenantId,
            definitionId: binding.run.definitionId,
            runId: binding.run.id,
          }
        : null;
    },
  });
  app.route("/:projectId/coordinator", tokens);
  return app;
}

// Reuse the package's tenant-scoped revoke operation. Its definition-token
// mint/list routes are deliberately unavailable; bounded owners cannot use them.
export function createCoordinatorTokenRevocationRoutes(
  db: ReturnType<typeof createDB>["db"],
) {
  const app = new Hono<TenantEnv>();
  const requireGrant = createRequireGrant({
    grantStore: createGrantStore(db),
    conditionRegistry: HUB_CONDITION_REGISTRY,
  });
  app.use("/agent-tokens", async (c) => c.json({ error: "not_found" }, 404));
  app.use("/agent-tokens/*", requireAuth, createResolveTenant({ db }));
  app.use("/agent-tokens/*", async (c, next) => {
    c.header("cache-control", "no-store");
    if (c.req.method !== "DELETE") return c.json({ error: "not_found" }, 404);
    await next();
  });
  mountAgentTokens(app, {
    db,
    requireGrant: requireGrant("credential:*", "create"),
    resolveDefinition: async () => false,
  });
  return app;
}
