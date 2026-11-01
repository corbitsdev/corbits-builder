import { type } from "arktype";
import { mountArtifactRoutes } from "../artifacts/routes.ts";
import { mountDesignThemeRoutes } from "../artifacts/design-themes.ts";
import { createArtifactService } from "../artifacts/service.ts";
import type { AgentActivityTracker } from "../artifacts/activity.ts";
import { mountProjectAuditRoutes } from "../audit/routes.ts";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { describeRoute, resolver } from "hono-openapi";
import {
  createResolveTenant,
  requireAuth,
  type AppEnv,
  type TenantEnv,
} from "@intx/hub-api";
import type { DB } from "@intx/db";
import { getLogger } from "@intx/log";
import type { RepoStore, WorkflowRunReader } from "@intx/hub-sessions";
import { TenantResponse } from "@intx/types";
import {
  ProjectExport,
  ProjectImportReceipt,
  ProjectLifecycleReceipt,
  ProjectMutation,
  ProjectMutationReceipt,
  ProjectShipReceipt,
  ProjectView,
  ProjectSummaryList,
} from "@corbits-builder/schemas/project";
import { readProjectImport } from "@corbits-builder/schemas/project-import";
import {
  createProjectService,
  type CreateTenant,
  type ProjectCaller,
} from "./service.ts";
import { actorOf, resolveProjectTenant } from "./authorization.ts";
import { ProjectError, typeIssues } from "./errors.ts";
import {
  createProjectNextStep,
  mountProjectNextStepRoutes,
} from "./next-step.ts";
import type { Actor } from "../lib/actor.ts";
import type { LiveApps } from "../live-app/runner.ts";
import { importedProjectMessage } from "../config/import.ts";
import { MODEL_CHOICE_REFUSALS } from "../config/models.ts";
import { mailRunAsCaller } from "../mail/caller-mail.ts";
import { readJson } from "../lib/json.ts";
import { errorCode, requestErrorMetadata } from "../request-error.ts";

const log = getLogger(["corbits-builder", "hub", "projects"]);

type CoordinatorStart = {
  ensure: (actor: Actor, projectId: string) => Promise<boolean>;
  attached: (actor: Actor, projectId: string) => Promise<boolean>;
  upgrade?: (actor: Actor, projectId: string) => Promise<void>;
};

// The coordinator takes a turn only when mail arrives, so a new project's first mail is the
// person's idea and an imported project's is its import. Sent through the native run mail route as
// the person, exactly as the UI sends a message.
async function mailOpening(
  c: Context<TenantEnv>,
  nativeFetch: ((request: Request) => Promise<Response>) | undefined,
  view: { tenantId: string; coordinatorRunId: string | null },
  message: string,
): Promise<void> {
  if (!nativeFetch || !view.coordinatorRunId)
    throw new ProjectError(409, "coordinator_start_failed");
  await mailRunAsCaller(
    c,
    nativeFetch,
    view.tenantId,
    view.coordinatorRunId,
    message,
  );
}

const TENANT_ERROR_STATUS = {
  400: 400,
  401: 403,
  403: 403,
  404: 404,
  409: 409,
} as const;
const IMPORT_MAX_BYTES = 20 * 1024 * 1024;

// Tenant creation is native: POST /api/tenants (hub-api routes/tenants.ts
// createTenantRoutes) runs as the calling user, checks `create` on `tenant:*`
// in the parent, and makes the caller the child's owner principal. hub-api does
// not export that logic, so the request goes through the composed app in-process.
export function nativeTenantCreation(
  c: Context,
  nativeFetch: ((request: Request) => Promise<Response>) | undefined,
): CreateTenant {
  return async (body) => {
    if (!nativeFetch)
      throw new ProjectError(503, "tenant_creation_unavailable");
    const headers = new Headers({ "content-type": "application/json" });
    for (const name of ["cookie", "authorization"]) {
      const value = c.req.header(name);
      if (value) headers.set(name, value);
    }
    const response = await nativeFetch(
      new Request(new URL("/api/tenants", c.req.url).href, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
    const payload: unknown = await readJson(response);
    if (response.status === 201)
      return { id: TenantResponse.assert(payload).id };
    const upstream =
      payload !== null && typeof payload === "object" && "error" in payload
        ? payload.error
        : null;
    const code =
      upstream !== null && typeof upstream === "object" && "code" in upstream
        ? String(upstream.code)
        : "tenant_create_failed";
    if (response.status === 409)
      throw new ProjectError(409, "tenant_slug_taken");
    const status =
      TENANT_ERROR_STATUS[
        response.status as keyof typeof TENANT_ERROR_STATUS
      ] ?? 503;
    throw new ProjectError(status, code);
  };
}

function caller(c: Context<TenantEnv>): ProjectCaller {
  return {
    ...actorOf(c),
    userId: c.get("user")?.id,
    parentTenantId: c.get("tenant").parentId,
  };
}

// The create's own failure is what the caller sees; a project left unarchived only keeps its card.
async function archiveFailedCreate(
  archive: (actor: Actor, projectId: string) => Promise<unknown>,
  actor: Actor,
  projectId: string,
) {
  try {
    await archive(actor, projectId);
  } catch (error) {
    log.warn("Archiving failed project create {projectId} failed", {
      projectId,
      ...errorCode(error),
      ...requestErrorMetadata(error),
    });
  }
}

// A project whose coordinator never started is archived, so the failed create
// leaves no card behind; a retry replays the receipt and starts it again. One
// refused only for want of a model profile stays, and starts once one resolves.
async function startNewProject(
  start: CoordinatorStart | undefined,
  archive: (actor: Actor, projectId: string) => Promise<unknown>,
  actor: Actor,
  projectId: string,
) {
  if (!start) return;
  try {
    await start.ensure(actor, projectId);
  } catch (error) {
    if (!(error instanceof ProjectError && error.code in MODEL_CHOICE_REFUSALS))
      await archiveFailedCreate(archive, actor, projectId);
    throw error;
  }
}

export function createProjectRoutes(
  db: DB["db"],
  runs: WorkflowRunReader,
  authenticate: MiddlewareHandler<AppEnv> = requireAuth,
  startCoordinator?: CoordinatorStart,
  stopCoordinator?: (actor: Actor, projectId: string) => Promise<void>,
  nativeFetch?: (request: Request) => Promise<Response>,
  activity?: AgentActivityTracker,
  sidecarDataDir?: string,
  liveApps?: LiveApps,
  cancelRun?: (
    tenantId: string,
    runId: string,
    reason: string,
  ) => Promise<unknown>,
  repoStore?: RepoStore,
) {
  const app = new Hono<TenantEnv>();
  const service = createProjectService(db);
  const artifacts = createArtifactService(
    db,
    runs,
    activity,
    sidecarDataDir,
    liveApps,
    cancelRun,
    repoStore,
  );
  // A project's coordinator can end (lifetime expiry, failure, archive) while its documents stay.
  // A fresh one takes no turn until mail arrives; the person's next message carries the held
  // resume context (coordinator-resume.ts), so the resume itself mails nothing.
  const archive = (actor: Actor, id: string) =>
    service.lifecycle(actor, id, "archived");
  const resumeCoordinator = async (actor: Actor, projectId: string) =>
    (await startCoordinator?.ensure(actor, projectId)) ?? false;
  app.use("*", authenticate, createResolveTenant({ db }));
  app.use("/:projectId/*", resolveProjectTenant(db));
  app.use("*", async (c, next) => {
    c.header("cache-control", "no-store");
    await next();
  });
  // Registered ahead of the group's 3 MiB limit, which would otherwise run
  // first: one file carries every document and the app.
  app.post(
    "/import",
    bodyLimit({
      maxSize: IMPORT_MAX_BYTES,
      onError: (c) => c.json({ code: "project_request_too_large" }, 413),
    }),
    describeRoute({
      tags: ["Projects"],
      operationId: "importProject",
      security: [{ sessionCookie: [] }, { deviceBearer: [] }],
      parameters: [
        {
          name: "tenantId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(ProjectExport) } },
      },
      responses: {
        200: {
          description:
            "A new project with each document filed as version 1 of its kind; documents marked approved are recorded as the caller's approval of that version. Each of materials is filed as a material under its title. An original Solution Builder file (format solutions-builder.project) is converted first, its text documents and source files with no kind here becoming materials; omitted names its kinds with a document left out",
          content: {
            "application/json": { schema: resolver(ProjectImportReceipt) },
          },
        },
        400: {
          description: "Invalid project file, or two documents of one kind",
        },
        401: { description: "Authentication required" },
        403: { description: "Project create or artifact write refused" },
        409: {
          description: "Tenant slug conflict or coordinator start failed",
        },
        413: { description: "Request exceeds 20 MiB" },
        415: { description: "JSON content type required" },
        503: { description: "Native tenant creation unavailable" },
      },
    }),
    async (c) => {
      try {
        if (
          !/^application\/json(?:\s*;|$)/i.test(
            c.req.header("content-type") ?? "",
          )
        )
          return c.json({ code: "json_content_type_required" }, 415);
        const input = await readJson(c.req);
        if (input === undefined) throw new ProjectError(400, "invalid_json");
        const read = readProjectImport(input);
        if (read instanceof type.errors)
          throw new ProjectError(400, "invalid_project_import", {
            issues: typeIssues(read),
          });
        const { file, omitted } = read;
        const materials = file.materials ?? [];
        const kinds = file.documents.map((document) => document.kind);
        if (new Set(kinds).size !== kinds.length)
          throw new ProjectError(400, "duplicate_document_kind");
        const projectId = `i-${crypto.randomUUID().replaceAll("-", "")}`;
        const created = await service.mutate(
          caller(c),
          nativeTenantCreation(c, nativeFetch),
          projectId,
          {
            mutationId: crypto.randomUUID(),
            idempotencyKey: crypto.randomUUID(),
            command: "create_project",
            payload: { title: file.title },
          },
        );
        try {
          for (const { approved, ...document } of file.documents) {
            const { artifact } = await artifacts.write(
              created.actor,
              projectId,
              document,
            );
            if (approved)
              await artifacts.recordImportApproval(
                created.actor,
                projectId,
                artifact,
              );
          }
          for (const material of materials)
            await artifacts.fileMaterial(created.actor, projectId, material);
        } catch (error) {
          await archiveFailedCreate(archive, created.actor, projectId);
          throw error;
        }
        // The coordinator starts after filing, so its first look at the
        // document list already shows every imported document.
        await startNewProject(
          startCoordinator,
          archive,
          created.actor,
          projectId,
        );
        // Without its opening mail the coordinator never takes a turn, so the project is archived
        // as a failed create is.
        try {
          await mailOpening(
            c,
            nativeFetch,
            await service.read(created.actor, projectId),
            importedProjectMessage(
              materials.map(({ title }) => title),
              kinds.includes("app"),
            ),
          );
        } catch (error) {
          await archiveFailedCreate(archive, created.actor, projectId);
          throw error;
        }
        return c.json(ProjectImportReceipt.assert({ projectId, omitted }));
      } catch (error) {
        if (error instanceof ProjectError)
          return c.json({ code: error.code, ...error.details }, error.status);
        throw error;
      }
    },
  );
  app.use(
    "*",
    // Filing an app sends its 1 MiB bundle as a JSON string inside the request, escaped once more.
    bodyLimit({
      maxSize: 3 * 1024 * 1024,
      onError: (c) => c.json({ code: "project_request_too_large" }, 413),
    }),
  );
  app.get(
    "/",
    describeRoute({
      tags: ["Projects"],
      operationId: "listProjects",
      security: [{ sessionCookie: [] }, { deviceBearer: [] }],
      parameters: [
        {
          name: "tenantId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "status",
          in: "query",
          schema: { type: "string", enum: ["active", "archived", "all"] },
        },
      ],
      responses: {
        200: {
          description:
            "Workspace project tenants the caller is a member of with a read grant, oldest first; other projects are absent, never redacted. Each carries its stage from native state: shipped when the person marked it, building once any coder run exists, even one that failed or was refused, else idea; and its last activity, the latest of a project change, a run starting or ending, and a document filed",
          content: {
            "application/json": { schema: resolver(ProjectSummaryList) },
          },
        },
        400: { description: "Invalid status filter" },
        401: { description: "Authentication required" },
        403: { description: "Tenant membership required" },
      },
    }),
    async (c) => {
      try {
        return c.json(
          await service.list(
            caller(c),
            c.get("user")?.id,
            c.req.query("status"),
          ),
        );
      } catch (error) {
        if (error instanceof ProjectError)
          return c.json({ code: error.code }, error.status);
        throw error;
      }
    },
  );
  app.get(
    "/:projectId",
    describeRoute({
      tags: ["Projects"],
      operationId: "readProjectStatus",
      security: [
        { sessionCookie: [] },
        { deviceBearer: [] },
        { coordinatorBearer: [] },
      ],
      parameters: [
        {
          name: "tenantId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "projectId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: {
          description:
            "Project identity, its tenant, lifecycle status and version lineage",
          content: { "application/json": { schema: resolver(ProjectView) } },
        },
        400: { description: "Invalid project ID" },
        401: { description: "Authentication required" },
        403: { description: "Project read refused" },
        404: { description: "Project not found in tenant" },
      },
    }),
    async (c) => {
      try {
        return c.json(await service.read(actorOf(c), c.req.param("projectId")));
      } catch (error) {
        if (error instanceof ProjectError)
          return c.json({ code: error.code, ...error.details }, error.status);
        throw error;
      }
    },
  );
  app.post(
    "/:projectId/mutations",
    describeRoute({
      tags: ["Projects"],
      operationId: "mutateProject",
      security: [
        { sessionCookie: [] },
        { deviceBearer: [] },
        { coordinatorBearer: [] },
      ],
      parameters: [
        {
          name: "tenantId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "projectId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(ProjectMutation) } },
      },
      responses: {
        200: {
          description:
            "Committed or byte-identically replayed mutation receipt",
          content: {
            "application/json": { schema: resolver(ProjectMutationReceipt) },
          },
        },
        400: {
          description:
            "Invalid typed mutation; protected fields are not writable",
        },
        401: { description: "Authentication required" },
        403: {
          description: "Project, source or parent-tenant create grant refused",
        },
        404: { description: "Project not found in tenant" },
        409: {
          description:
            "Project, tenant slug or idempotency conflict, or the new project's coordinator could not start; a project refused with model_provider_missing or model_profile_required is kept",
        },
        503: { description: "Native tenant creation unavailable" },
        413: { description: "Request exceeds 3 MiB" },
        415: { description: "JSON content type required" },
      },
    }),
    async (c) => {
      try {
        if (
          !/^application\/json(?:\s*;|$)/i.test(
            c.req.header("content-type") ?? "",
          )
        )
          return c.json({ code: "json_content_type_required" }, 415);
        const input = await readJson(c.req);
        if (input === undefined) throw new ProjectError(400, "invalid_json");
        const result = await service.mutate(
          caller(c),
          nativeTenantCreation(c, nativeFetch),
          c.req.param("projectId"),
          input,
        );
        const command =
          input !== null && typeof input === "object" && "command" in input
            ? input.command
            : null;
        if (command === "create_project" || command === "version_project") {
          await startNewProject(
            startCoordinator,
            archive,
            result.actor,
            result.projectId,
          );
          // The idea typed to start the project is the coordinator's first mail. It is sent here,
          // in the request that committed the project, into the run's durable native inbox, so a
          // reload or a lost browser send cannot drop it.
          if (result.opening !== undefined) {
            try {
              await mailOpening(
                c,
                nativeFetch,
                await service.read(result.actor, result.projectId),
                result.opening,
              );
            } catch (error) {
              await archiveFailedCreate(
                archive,
                result.actor,
                result.projectId,
              );
              throw error;
            }
          }
        }
        return c.body(result.body, 200, { "content-type": "application/json" });
      } catch (error) {
        if (error instanceof ProjectError)
          return c.json({ code: error.code, ...error.details }, error.status);
        throw error;
      }
    },
  );
  // A project's own transition, which needs manage authority on it and repeats idempotently.
  const projectAction = (
    path: `/:projectId/${string}`,
    operationId: string,
    outcome: { description: string; schema: Parameters<typeof resolver>[0] },
    archived: string | undefined,
    act: (actor: Actor, projectId: string) => Promise<unknown>,
  ) =>
    app.post(
      path,
      describeRoute({
        tags: ["Projects"],
        operationId,
        security: [{ sessionCookie: [] }, { deviceBearer: [] }],
        parameters: [
          {
            name: "tenantId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "projectId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          200: {
            description: outcome.description,
            content: {
              "application/json": { schema: resolver(outcome.schema) },
            },
          },
          400: { description: "Invalid project ID" },
          401: { description: "Authentication required" },
          403: { description: "Project manage authority required" },
          404: { description: "Project not found in tenant" },
          ...(archived ? { 409: { description: archived } } : {}),
        },
      }),
      async (c) => {
        try {
          return c.json(await act(actorOf(c), c.req.param("projectId")));
        } catch (error) {
          if (error instanceof ProjectError)
            return c.json({ code: error.code, ...error.details }, error.status);
          throw error;
        }
      },
    );
  const lifecycle = {
    description:
      "Current lifecycle receipt; repeating the same transition is idempotent, and archived projects refuse mutations until restored",
    schema: ProjectLifecycleReceipt,
  };
  projectAction(
    "/:projectId/archive",
    "archiveProject",
    lifecycle,
    undefined,
    async (actor, id) => {
      const receipt = await archive(actor, id);
      // Archived projects must not hold a sidecar slot.
      await stopCoordinator?.(actor, id);
      return receipt;
    },
  );
  projectAction(
    "/:projectId/restore",
    "restoreProject",
    lifecycle,
    undefined,
    async (actor, id) => {
      const receipt = await service.lifecycle(actor, id, "active");
      // Restore starts a fresh coordinator run.
      await resumeCoordinator(actor, id);
      return receipt;
    },
  );
  const ship = {
    description:
      "The person's shipped mark, set or cleared; repeating it is idempotent. The project stays active, so its documents, app and coordinator stay usable",
    schema: ProjectShipReceipt,
  };
  for (const [path, operationId, shipped] of [
    ["/:projectId/ship", "shipProject", true],
    ["/:projectId/unship", "unshipProject", false],
  ] as const)
    projectAction(path, operationId, ship, "Project archived", (actor, id) =>
      service.ship(actor, id, shipped),
    );
  app.post(
    "/:projectId/coordinator",
    describeRoute({
      tags: ["Projects"],
      operationId: "startProjectCoordinator",
      security: [{ sessionCookie: [] }, { deviceBearer: [] }],
      parameters: [
        {
          name: "tenantId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
        {
          name: "projectId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: {
          description:
            "The project's coordinator is running, moved onto the current coordinator first when it is idle on an older one; started says whether this request started it",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { started: { type: "boolean" } },
              },
            },
          },
        },
        400: { description: "Invalid project ID" },
        401: { description: "Authentication required" },
        403: { description: "Project read authority required" },
        404: { description: "Project not found in tenant" },
        409: {
          description:
            "Project archived, or the coordinator could not start or move onto the caller's model choice; model_provider_missing and model_profile_required carry a message saying what to set up",
        },
      },
    }),
    async (c) => {
      try {
        const actor = actorOf(c);
        const projectId = c.req.param("projectId");
        const view = await service.read(actor, projectId);
        if (view.status !== "active")
          throw new ProjectError(409, "project_archived");
        await startCoordinator?.upgrade?.(actor, projectId);
        return c.json({ started: await resumeCoordinator(actor, projectId) });
      } catch (error) {
        if (error instanceof ProjectError)
          return c.json({ code: error.code, ...error.details }, error.status);
        throw error;
      }
    },
  );
  mountArtifactRoutes(app, artifacts, nativeFetch);
  mountProjectNextStepRoutes(app, createProjectNextStep(db, runs, liveApps));
  mountDesignThemeRoutes(app, db);
  mountProjectAuditRoutes(app, db);
  return app;
}
