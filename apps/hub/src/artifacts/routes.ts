import { type } from "arktype";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { contentDispositionHeader } from "@corbits/artifacts";
import { PER_MESSAGE_TOTAL_LIMIT_BYTES } from "@intx/types";
import { describeRoute, resolver } from "hono-openapi";
import type { TenantEnv } from "@intx/hub-api";
import {
  AcceptanceChecklist,
  AcceptedMaterials,
  AppSnapshotReceipt,
  AppVersionList,
  ArtifactApprovalReceipt,
  ArtifactApprovalRecord,
  ArtifactContent,
  ArtifactKindWrite,
  ArtifactList,
  ArtifactReceipt,
  DecidedApprovalList,
  DesignChoice,
  DesignChoiceReceipt,
  DesignConceptRecord,
  DesignDraft,
  DesignTweaks,
  DesignTweaksReceipt,
  LiveApp,
  MAX_APPROVAL_PACKAGE_BYTES,
  MaterialReceipt,
} from "@corbits-builder/schemas/artifact";
import { ProjectActivity } from "@corbits-builder/schemas/activity";
import {
  EXPORT_SECTIONS,
  ExportSection,
  ProjectExport,
} from "@corbits-builder/schemas/project";
import { actorOf } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import { readJson } from "../lib/json.ts";
import { mailRunAsCaller } from "../mail/caller-mail.ts";
import type { createArtifactService } from "./service.ts";

const security = [
  { sessionCookie: [] },
  { deviceBearer: [] },
  { coordinatorBearer: [] },
];

// Mounted inside the authenticated project route group; the project tenant
// middleware has already switched the request into the project's tenant.
export function mountArtifactRoutes(
  app: Hono<TenantEnv>,
  service: ReturnType<typeof createArtifactService>,
  nativeFetch?: (request: Request) => Promise<Response>,
) {
  const body = async (c: { req: { json(): Promise<unknown> } }) => {
    const json = await readJson(c.req);
    if (json === undefined) throw new ProjectError(400, "invalid_json");
    return json;
  };
  app.get(
    "/:projectId/artifacts",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "listProjectArtifacts",
      security,
      responses: {
        200: {
          description: "Project artifacts at their current versions",
          content: { "application/json": { schema: resolver(ArtifactList) } },
        },
      },
    }),
    async (c) => {
      return c.json(await service.list(actorOf(c), c.req.param("projectId")));
    },
  );
  app.get(
    "/:projectId/activity",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "readProjectActivity",
      description:
        "The runs at work in the project: the coordinator while a message run is in progress, and every writer, reviewer, designer and coder run Interchange reports deployed or running. Each carries the latest tool calls and assistant text from the run's own inference events, as far as this hub has seen them since it started.",
      security,
      responses: {
        200: {
          description: "Runs at work and their latest native activity",
          content: {
            "application/json": { schema: resolver(ProjectActivity) },
          },
        },
      },
    }),
    async (c) => {
      return c.json(
        await service.activity(actorOf(c), c.req.param("projectId")),
      );
    },
  );
  app.get(
    "/:projectId/approvals",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "listDecidedApprovals",
      description:
        "The project's native approvals that are no longer pending, oldest first: the tool and arguments asked, how the record settled it and with what scope, and the document versions the hub recorded it approving. Requires the tenant-wide approval grant the native pending list requires.",
      security,
      responses: {
        200: {
          description: "Decided approvals",
          content: {
            "application/json": { schema: resolver(DecidedApprovalList) },
          },
        },
        403: { description: "Approval read refused" },
        404: { description: "Project not found in tenant" },
      },
    }),
    async (c) => {
      return c.json(
        await service.decidedApprovals(actorOf(c), c.req.param("projectId")),
      );
    },
  );
  app.post(
    "/:projectId/artifacts",
    bodyLimit({
      maxSize: MAX_APPROVAL_PACKAGE_BYTES + 1024 * 1024,
      onError: (c) => c.json({ code: "artifact_too_large" }, 413),
    }),
    describeRoute({
      tags: ["Artifacts"],
      operationId: "writeProjectArtifact",
      security,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: resolver(ArtifactKindWrite) },
        },
      },
      responses: {
        200: {
          description: "Next version of the project's artifact of this kind",
          content: {
            "application/json": { schema: resolver(ArtifactReceipt) },
          },
        },
      },
    }),
    async (c) => {
      return c.json(
        await service.write(
          actorOf(c),
          c.req.param("projectId"),
          await body(c),
        ),
      );
    },
  );
  app.get(
    "/:projectId/design-draft",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "readProjectDesignDraft",
      security,
      parameters: [
        {
          name: "concept",
          in: "query",
          description:
            "The design concept whose live designer to read, as its run's inFlight concept names it; without it, the designer working on the design itself",
          schema: { type: "string", minLength: 1 },
        },
      ],
      responses: {
        200: {
          description:
            "The live designer's .builder/designs as it stands, before it files the design or its concept's option",
          content: { "application/json": { schema: resolver(DesignDraft) } },
        },
        404: {
          description:
            "No designer is at work on a mockup for this project or concept",
        },
      },
    }),
    async (c) => {
      return c.json(
        await service.designDraft(
          actorOf(c),
          c.req.param("projectId"),
          c.req.query("concept"),
        ),
      );
    },
  );
  app.get(
    "/:projectId/design-draft/previous",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "readPreviousDesignDraft",
      description:
        "For the calling designer run: the newest draft an earlier designer run of this project left for the same design concept, with its DESIGN.md, so the design continues from it.",
      security,
      responses: {
        200: {
          description:
            "The earlier designer's DESIGN.md and designs/ as it left them",
          content: { "application/json": { schema: resolver(DesignDraft) } },
        },
        404: {
          description: "No earlier designer left a draft for this concept",
        },
      },
    }),
    async (c) => {
      return c.json(
        await service.previousDesignDraft(actorOf(c), c.req.param("projectId")),
      );
    },
  );
  app.post(
    "/:projectId/design-tweaks",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "saveDesignTweaks",
      description:
        "Writes the person's look tokens into the design's styles.css :root: the live designer's workspace (the concept's designer when concept is named), else the filed design's, or the concept's option's, next version. Then tells the coordinator, and the live designer, as the person. A save is never an approval: no approval is recorded and nothing moves the project forward.",
      security,
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(DesignTweaks) } },
      },
      responses: {
        200: {
          description: "Where the tokens were written and which runs were told",
          content: {
            "application/json": { schema: resolver(DesignTweaksReceipt) },
          },
        },
        404: {
          description: "Neither a live designer nor a filed design to update",
        },
      },
    }),
    async (c) => {
      const current = actorOf(c);
      return c.json(
        await service.saveDesignTweaks(
          current,
          c.req.param("projectId"),
          await body(c),
          (runId, content) =>
            mailRunAsCaller(c, nativeFetch, current.tenantId, runId, content),
        ),
      );
    },
  );
  app.post(
    "/:projectId/design-choice",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "chooseDesign",
      description:
        "The person chooses a filed design_option at the version they saw. The hub files it as the project's design, records the person's approval of exactly that design version and hash, stops the other concepts' designers, and tells the coordinator which design the person chose. Only a person may choose; the coordinator never does.",
      security,
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(DesignChoice) } },
      },
      responses: {
        200: {
          description:
            "The filed and approved design version and the chosen concept",
          content: {
            "application/json": { schema: resolver(DesignChoiceReceipt) },
          },
        },
        403: {
          description: "The caller is not a person who manages the project",
        },
        404: { description: "No filed design option with that id" },
        409: {
          description: "The option has a newer version than the one chosen",
        },
      },
    }),
    async (c) => {
      const current = actorOf(c);
      return c.json(
        await service.chooseDesign(
          current,
          c.req.param("projectId"),
          await body(c),
          (runId, content) =>
            mailRunAsCaller(c, nativeFetch, current.tenantId, runId, content),
        ),
      );
    },
  );
  app.get(
    "/:projectId/materials/accepted",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "readAcceptedMaterials",
      description:
        "The file types the project's coordinator model reads, from the vision-input and document-input capabilities its catalog offering declares, with Interchange's attachment limits. Empty mimeTypes means no attachment is accepted.",
      security,
      responses: {
        200: {
          description: "Accepted attachment types and limits",
          content: {
            "application/json": { schema: resolver(AcceptedMaterials) },
          },
        },
      },
    }),
    async (c) => {
      return c.json(
        await service.acceptedMaterials(actorOf(c), c.req.param("projectId")),
      );
    },
  );
  app.post(
    "/:projectId/materials",
    bodyLimit({
      maxSize: PER_MESSAGE_TOTAL_LIMIT_BYTES + 1024 * 1024,
      onError: (c) => c.json({ code: "oversize_total" }, 413),
    }),
    describeRoute({
      tags: ["Artifacts"],
      operationId: "attachMaterials",
      description:
        "Files each multipart `file` as a material artifact titled by its filename (the same filename again is its next version), then mails the files to the project's coordinator as native attachments with `message`, or a note naming them. A type the coordinator model does not read is refused with material_type_not_accepted; Interchange's attachment codes (too_many_attachments, oversize_attachment, oversize_total, disallowed_mime_type, invalid_attachment_name) come back unchanged.",
      security,
      requestBody: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["file"],
              properties: {
                file: {
                  type: "array",
                  items: { type: "string", format: "binary" },
                },
                message: { type: "string" },
              },
            },
          },
        },
      },
      responses: {
        200: {
          description: "The filed material versions",
          content: {
            "application/json": { schema: resolver(MaterialReceipt) },
          },
        },
        400: {
          description:
            "No file, an attachment refused, or a type the model does not read",
        },
        409: { description: "The project has no running coordinator" },
      },
    }),
    async (c) => {
      const current = actorOf(c);
      let form: FormData;
      try {
        form = await c.req.formData();
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        throw new ProjectError(400, "invalid_form", {}, { cause: error });
      }
      const message = form.get("message");
      return c.json(
        await service.attachMaterials(
          current,
          c.req.param("projectId"),
          form
            .getAll("file")
            .filter((value): value is File => value instanceof File),
          typeof message === "string" ? message : "",
          (runId, content, attachments) =>
            mailRunAsCaller(
              c,
              nativeFetch,
              current.tenantId,
              runId,
              content,
              attachments,
            ),
        ),
      );
    },
  );
  app.post(
    "/:projectId/design-concepts",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "recordDesignConcept",
      description:
        "Names the design concept a designer run the coordinator just deployed works on; the run's design is filed as that concept's design_option.",
      security,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: resolver(DesignConceptRecord) },
        },
      },
      responses: {
        200: {
          description: "The recorded run and concept",
          content: {
            "application/json": { schema: resolver(DesignConceptRecord) },
          },
        },
      },
    }),
    async (c) => {
      return c.json(
        await service.recordDesignConcept(
          actorOf(c),
          c.req.param("projectId"),
          await body(c),
        ),
      );
    },
  );
  app.get(
    "/:projectId/acceptance",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "readProjectAcceptance",
      security,
      responses: {
        200: {
          description:
            "The live coder's ACCEPTANCE.md, the build plan's acceptance checklist as it ticks items off; with no coder at work, the one filed with the latest app",
          content: {
            "application/json": { schema: resolver(AcceptanceChecklist) },
          },
        },
        404: {
          description:
            "Neither a coder at work nor the filed app has a checklist",
        },
      },
    }),
    async (c) => {
      return c.json(
        await service.acceptance(actorOf(c), c.req.param("projectId")),
      );
    },
  );
  app.get(
    "/:projectId/app",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "readLiveApp",
      description:
        "The project's app as the hub runs it while the project is open, from the project's current files: the build workspace's while a coder builds, else the latest filed version. Reading never starts it. A running app is served at url, an origin of its own on this host whose every request needs the same session and project read access as this route.",
      security,
      responses: {
        200: {
          description:
            "Whether the app is running, starting, stopped, failed or has no files yet",
          content: { "application/json": { schema: resolver(LiveApp) } },
        },
        503: { description: "This hub does not serve apps" },
      },
    }),
    async (c) => {
      return c.json(
        await service.liveApp(
          actorOf(c),
          c.req.param("tenantId")!,
          c.req.param("projectId"),
        ),
      );
    },
  );
  app.post(
    "/:projectId/app/keep-alive",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "keepLiveApp",
      description:
        "Says the project is open. The hub runs one app per project from its current files, in the coder's sandbox on ports it picks, with the app's own dev script, so every change to those files shows at once; packages are installed again when they change and a crashed app restarts. It stops once this route has not been called for a minute and starts again on the next call.",
      security,
      responses: {
        200: {
          description: "The app's state after the request",
          content: { "application/json": { schema: resolver(LiveApp) } },
        },
        503: { description: "This hub does not serve apps" },
      },
    }),
    async (c) => {
      return c.json(
        await service.keepLiveApp(
          actorOf(c),
          c.req.param("tenantId")!,
          c.req.param("projectId"),
        ),
      );
    },
  );
  app.post(
    "/:projectId/app/snapshot",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "snapshotApp",
      description:
        "Files the newest coder run's workspace, whether that run is live or ended, as the next version of the project's app, whatever its check or approval state. Its .gitignore is honored and installs, build output, environment files and the builder's own files are left out; files that are not text are kept. When the latest version already holds exactly these files, nothing is filed and that version is named.",
      security,
      responses: {
        200: {
          description: "The app version that holds the workspace",
          content: {
            "application/json": { schema: resolver(AppSnapshotReceipt) },
          },
        },
        403: {
          description: "The viewer may read the project but not manage it",
        },
        404: {
          description:
            "No coder has run for this project (coder_run_not_found)",
        },
        409: {
          description:
            "The newest coder run's workspace cannot be read by this hub (app_workspace_unavailable, with its reason); an older run's workspace is never taken instead",
        },
        413: {
          description:
            "The app is larger than an app version holds (app_too_large)",
        },
      },
    }),
    async (c) => {
      return c.json(
        await service.snapshotApp(actorOf(c), c.req.param("projectId")),
      );
    },
  );
  app.get(
    "/:projectId/app/versions",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "listAppVersions",
      security,
      responses: {
        200: {
          description:
            "Every filed version of the project's app, newest first, with what filed it (a passing check, a snapshot or an import) and the coder run it came from, and whether this viewer can snapshot the current code now or why not",
          content: { "application/json": { schema: resolver(AppVersionList) } },
        },
      },
    }),
    async (c) => {
      return c.json(
        await service.appVersions(actorOf(c), c.req.param("projectId")),
      );
    },
  );
  app.get(
    "/:projectId/app/archive",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "downloadApp",
      description:
        "A filed version of the project's app (version, the latest when absent) as a zip of its files, under one directory named after the project. Installs, build output and environment files are never filed, so they are not in it.",
      security,
      parameters: [
        {
          name: "version",
          in: "query",
          schema: { type: "integer", minimum: 1 },
        },
      ],
      responses: {
        200: {
          description: "The app's source archive",
          content: {
            "application/zip": { schema: { type: "string", format: "binary" } },
          },
        },
        404: {
          description:
            "No app is filed for this project yet, or not that version",
        },
      },
    }),
    async (c) => {
      const query = c.req.query("version");
      const version = query === undefined ? undefined : Number(query);
      if (version !== undefined && !(Number.isInteger(version) && version > 0))
        throw new ProjectError(400, "invalid_app_version", {
          version: query,
        });
      const { filename, archive } = await service.appArchive(
        actorOf(c),
        c.req.param("projectId"),
        version,
      );
      return new Response(archive, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": contentDispositionHeader(
            "attachment",
            filename,
          ),
        },
      });
    },
  );
  app.get(
    "/:projectId/artifacts/:artifactId",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "readProjectArtifact",
      security,
      parameters: [
        {
          name: "version",
          in: "query",
          schema: { type: "integer", minimum: 1 },
        },
      ],
      responses: {
        200: {
          description:
            "The artifact's content at its current or the named version",
          content: {
            "application/json": { schema: resolver(ArtifactContent) },
          },
        },
      },
    }),
    async (c) => {
      const version = c.req.query("version");
      return c.json(
        await service.read(actorOf(c), c.req.param("projectId"), {
          artifactId: c.req.param("artifactId"),
          ...(version === undefined ? {} : { version: Number(version) }),
        }),
      );
    },
  );
  app.get(
    "/:projectId/export",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "exportProject",
      security,
      responses: {
        200: {
          description:
            "The project's title and every filed document at its current version, each marked approved when a person approved exactly that version",
          content: { "application/json": { schema: resolver(ProjectExport) } },
        },
      },
    }),
    async (c) => {
      return c.json(await service.export(actorOf(c), c.req.param("projectId")));
    },
  );
  app.get(
    "/:projectId/export/archive",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "exportProjectArchive",
      description:
        "The project as a zip named after it. sections (comma-separated planning, design, build; all when absent) picks planning/ (each document as <kind>.md and the person's materials), design/ (the design's files and each option's under options/<label>/) and build/ (the app's source). project.json, the file import reads, is always in it.",
      security,
      responses: {
        200: {
          description: "The project's zip",
          content: {
            "application/zip": { schema: { type: "string", format: "binary" } },
          },
        },
        400: {
          description:
            "sections names something other than planning, design or build",
        },
      },
    }),
    async (c) => {
      const query = c.req.query("sections");
      const sections = ExportSection.array()(
        query === undefined ? EXPORT_SECTIONS : query.split(","),
      );
      if (sections instanceof type.errors)
        throw new ProjectError(400, "invalid_export_sections", {
          issues: sections.summary,
        });
      const { filename, archive } = await service.exportArchive(
        actorOf(c),
        c.req.param("projectId"),
        sections,
      );
      return new Response(archive, {
        headers: {
          "content-type": "application/zip",
          "content-disposition": contentDispositionHeader(
            "attachment",
            filename,
          ),
        },
      });
    },
  );
  app.post(
    "/:projectId/artifact-approvals",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "recordArtifactApproval",
      security,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: resolver(ArtifactApprovalRecord) },
        },
      },
      responses: {
        200: {
          description:
            "The exact artifact versions the newest resolved deploy approval covers",
          content: {
            "application/json": { schema: resolver(ArtifactApprovalReceipt) },
          },
        },
      },
    }),
    async (c) => {
      return c.json(
        await service.recordApproval(
          actorOf(c),
          c.req.param("projectId"),
          await body(c),
        ),
      );
    },
  );
}
