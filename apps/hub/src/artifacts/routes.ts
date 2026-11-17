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
  UserManual,
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
  DesignDraft,
  DesignTweaks,
  DesignTweaksReceipt,
  DocumentApproval,
  DocumentApprovalReceipt,
  LiveApp,
  MaterialReceipt,
  MaterialRemovedReceipt,
  ProjectRuns,
  RunAction,
  RunActionStart,
  DesignConceptRecord,
} from "@corbits-builder/schemas/artifact";
import { ProjectActivity, RunBlock } from "@corbits-builder/schemas/activity";
import { showsScreen } from "@corbits-builder/schemas/conversation";
import {
  EXPORT_SECTIONS,
  ExportSection,
  ProjectExport,
} from "@corbits-builder/schemas/project";
import { actorOf } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import { body, security } from "../http/route-parts.ts";
import { mailRunAsCaller } from "../mail/caller-mail.ts";
import { documentApprovedNote } from "../config/answers.ts";
import { askedQuestions } from "../plugins/question.ts";
import type { Checks } from "../plugins/checks.ts";
import { projectFacts } from "../plugins/facts.ts";
import { mountApprovalRoundRoutes } from "./approval-rounds.ts";
import {
  CATALOG,
  catalogOf,
  isReadyPlan,
  isWorkflowAction,
  PLUGINS,
  ProjectFollowing,
} from "../plugins/catalog.ts";
import type { createArtifactService } from "./service.ts";
import { projectValueWrites } from "../values/project-values.ts";
import type { Answer } from "../answers/answer.ts";

// Each installed ready-made plan, by its handle, with the fact that ends it.
const READY_PLANS = new Map(
  PLUGINS.filter(isReadyPlan).map(({ builder }) => [
    builder.handle,
    builder.ends,
  ]),
);

// The fact a document's approval makes true, followed by its kind.
const APPROVED = "approved:";

// The app version a download or an export names, or undefined for the saved app.
function appVersionQuery(c: {
  req: { query(name: string): string | undefined };
}) {
  const query = c.req.query("version");
  const version = query === undefined ? undefined : Number(query);
  if (version !== undefined && !(Number.isInteger(version) && version > 0))
    throw new ProjectError(400, "invalid_app_version", { version: query });
  return version;
}

// Mounted inside the authenticated project route group; the project tenant
// middleware has already switched the request into the project's tenant.
export function mountArtifactRoutes(
  app: Hono<TenantEnv>,
  service: ReturnType<typeof createArtifactService>,
  {
    answer,
    nativeFetch,
    checks,
  }: {
    answer: Answer;
    nativeFetch?: ((request: Request) => Promise<Response>) | undefined;
    checks?: Checks | undefined;
  },
) {
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
          description:
            "The version of the project's artifact of this kind that now holds this content: the next one, or the current one when an app or a design is filed again unchanged",
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
        "For the calling designer run: the draft the design continues from, with its DESIGN.md. The newest earlier designer run of this project for the same design concept decides. It is that run's workspace while it runs, or once it ended unless the concept's design option, or the design without a concept, was filed since. Else it is that filed design at its latest version, with the look the person saved.",
      security,
      responses: {
        200: {
          description:
            "The earlier designer's DESIGN.md and designs/ as it left them, or as last filed",
          content: { "application/json": { schema: resolver(DesignDraft) } },
        },
        404: {
          description:
            "No earlier designer left a draft for this concept and none is filed",
        },
      },
    }),
    async (c) => {
      return c.json(
        await service.previousDesignDraft(actorOf(c), c.req.param("projectId")),
      );
    },
  );
  app.get(
    "/:projectId/following",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "readProjectFollowing",
      description:
        "The handles of the ready-made plans the project is following, none when it follows none. A plan whose ending fact holds is finished and no longer followed.",
      security,
      responses: {
        200: {
          description: "The ready-made plans the project is following",
          content: {
            "application/json": { schema: resolver(ProjectFollowing) },
          },
        },
        503: { description: "The hub cannot read the project's records" },
      },
    }),
    async (c) => {
      const current = actorOf(c);
      const projectId = c.req.param("projectId");
      if (!checks) throw new ProjectError(503, "following_unavailable");
      const listed = await service.list(current, projectId);
      const facts = projectFacts({
        artifacts: listed.artifacts,
        preferences: listed.preferences,
        checks: await checks.latest(current, projectId),
      });
      const handles = await service.projectFollowing(current, projectId);
      return c.json({
        following: handles.filter((handle) => {
          const ends = READY_PLANS.get(handle);
          return ends === undefined || !facts.has(ends);
        }),
      });
    },
  );
  app.post(
    "/:projectId/following",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "setProjectFollowing",
      description:
        "Sets the installed ready-made plans the project is following, by their handles; none stops it following any.",
      security,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: resolver(ProjectFollowing) },
        },
      },
      responses: {
        200: {
          description: "The ready-made plans the project is now following",
          content: {
            "application/json": { schema: resolver(ProjectFollowing) },
          },
        },
        400: {
          description: "A handle that is not an installed ready-made plan",
        },
      },
    }),
    async (c) => {
      const input = ProjectFollowing(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_project_following", {
          issues: input,
        });
      const unknown = input.following.find(
        (handle) => !READY_PLANS.has(handle),
      );
      if (unknown !== undefined)
        throw new ProjectError(400, "unknown_ready_plan", { plan: unknown });
      return c.json({
        following: await service.setFollowing(
          actorOf(c),
          c.req.param("projectId"),
          input.following,
        ),
      });
    },
  );
  app.post(
    "/:projectId/run-actions",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "recordRunAction",
      description:
        "Records the plugin action the coordinator just started a specialist run for, before the run's assignment reaches it, and the id of the plan step it does when the coordinator could tell which. The run is then listed among the coordinator's runs, the plan shows it on that step, the coordinator may stop it, and it may save the project values that action writes. What the action's start keeps for the run comes with it: a record, checked against the record the action's definition declares and stored against the run, and project values, each one the action writes, checked against its declared type and stored as the values route stores it.",
      security,
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(RunActionStart) } },
      },
      responses: {
        200: {
          description: "The recorded run and action",
          content: { "application/json": { schema: resolver(RunAction) } },
        },
        400: {
          description:
            "A record the action does not declare, a value it does not write or its type refuses, or a run started as a role other than the one the action starts",
        },
        404: {
          description:
            "No specialist run by that id in the project, or no installed action by that name",
        },
      },
    }),
    async (c) => {
      const current = actorOf(c);
      const projectId = c.req.param("projectId");
      const input = RunActionStart(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_run_action", { issues: input });
      const catalog = await catalogOf(service.projectState, current, projectId);
      const action = catalog.actions
        .filter(isWorkflowAction)
        .find(
          (installed) =>
            installed.plugin === input.plugin &&
            installed.action === input.action,
        );
      if (!action)
        throw new ProjectError(404, "action_not_installed", {
          plugin: input.plugin,
          action: input.action,
        });
      const kept = action.keep(input);
      if (!kept.ok)
        throw new ProjectError(400, "invalid_run_keep", {
          text: kept.problem,
        });
      const values = input.values ?? {};
      // A start clears a value it writes with null, as a first build that names no starter does.
      projectValueWrites(
        Object.fromEntries(
          Object.entries(values).filter(([, value]) => value !== null),
        ),
        await service.projectState(current, projectId),
        CATALOG.values,
      );
      return c.json(
        await service.recordRunAction(
          current,
          projectId,
          {
            runId: input.runId,
            plugin: input.plugin,
            action: input.action,
            role: catalog.packages.get(action.workflow)?.role,
            step: input.step,
            record: kept.record,
          },
          values,
        ),
      );
    },
  );
  app.get(
    "/:projectId/runs",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "listCoordinatorRuns",
      description:
        "The runs the coordinator started in the project for a plugin action: every one still at work, with its state and latest activity as far as this hub saw it, and the latest that ended, with why when one failed.",
      security,
      responses: {
        200: {
          description: "The coordinator's runs, newest first",
          content: { "application/json": { schema: resolver(ProjectRuns) } },
        },
      },
    }),
    async (c) =>
      c.json({
        runs: await service.runs(actorOf(c), c.req.param("projectId")),
      }),
  );
  app.post(
    "/:projectId/runs/:runId/stop",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "stopCoordinatorRun",
      description:
        "Stops a run the coordinator started in the project, for the person or the coordinator, through Interchange's cancellation; the coordinator's note on its end says which stopped it. What the run filed or pushed before it stopped is kept.",
      security,
      responses: {
        200: { description: "The stop was requested" },
        404: {
          description:
            "No run the coordinator started in the project by that id",
        },
        409: { description: "The run has already ended" },
      },
    }),
    async (c) =>
      c.json(
        await service.stopRun(
          actorOf(c),
          c.req.param("projectId"),
          c.req.param("runId"),
          c.get("principal")?.kind === "user" ? "person" : "coordinator",
        ),
      ),
  );
  app.post(
    "/:projectId/run-block",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "recordRunBlock",
      description:
        "A specialist run records what stops its work and what it tried, in its own words or in Builder's for it. The run shows as blocked once it ends, and the coordinator's note on its end leads with the block.",
      security,
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(RunBlock) } },
      },
      responses: {
        200: { description: "The block was recorded" },
        400: { description: "No reason or nothing tried" },
        403: {
          description: "The caller is not a run started for a plugin action",
        },
      },
    }),
    async (c) => {
      const input = RunBlock(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_run_block", { issues: input });
      return c.json(
        await service.recordBlock(actorOf(c), c.req.param("projectId"), input),
      );
    },
  );
  app.post(
    "/:projectId/run-block/end",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "endBlockedRun",
      description:
        "Ends the calling specialist run once its block is recorded, through Interchange's cancellation with the reason blocked, as a stop does.",
      security,
      responses: {
        200: { description: "The end was requested" },
        409: { description: "The run has recorded no block" },
      },
    }),
    async (c) =>
      c.json(await service.endBlockedRun(actorOf(c), c.req.param("projectId"))),
  );
  app.post(
    "/:projectId/artifacts/:artifactId/approval",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "approveDocument",
      description:
        "The signed-in person approves a filed document at the version they read, with no question asking for it. The hub records the approval of exactly that version as an approve screen's answer records it. When the coordinator is waiting on an approve question whose documents this approval now completes, the hub answers that question as the approve screen would, at each document's current version. Otherwise it leaves any such question open and sends the coordinator a hub note naming the document and version.",
      security: [{ sessionCookie: [] }, { deviceBearer: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(DocumentApproval) } },
      },
      responses: {
        200: {
          description: "The approval recorded, and the question it answered",
          content: {
            "application/json": {
              schema: resolver(DocumentApprovalReceipt),
            },
          },
        },
        403: { description: "The caller is not a person on the project" },
        404: { description: "No filed artifact by that id" },
        409: {
          description:
            "Not a document, or a version that is no longer the newest",
        },
      },
    }),
    async (c) => {
      const current = actorOf(c);
      const projectId = c.req.param("projectId");
      const artifactId = c.req.param("artifactId");
      const input = DocumentApproval(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_document_approval", {
          issues: input,
        });
      const { kind } = await service.read(current, projectId, { artifactId });
      // Read before recording, so a conversation that cannot be read refuses with nothing recorded.
      const { runId, questions } = await askedQuestions(
        c,
        nativeFetch,
        projectId,
      );
      await service.approveShown(
        current,
        projectId,
        [{ artifactId, version: input.version }],
        [APPROVED + kind],
        (coordinator, content) =>
          mailRunAsCaller(
            c,
            nativeFetch,
            current.tenantId,
            coordinator,
            content,
          ),
      );
      // The open question whose answer approves this document too, with every kind it approves.
      const { screens } = await catalogOf(
        service.projectState,
        current,
        projectId,
      );
      const [asking] = questions.flatMap((question) => {
        if (question.status !== "open" || !showsScreen(question)) return [];
        const { signalName, asked } = question;
        const screen = screens.find(
          ({ plugin, action }) =>
            plugin === asked.plugin && action === asked.action,
        );
        if (!screen) return [];
        const kinds = screen
          .returns(asked.input)
          .flatMap((fact) =>
            fact.startsWith(APPROVED) ? [fact.slice(APPROVED.length)] : [],
          );
        return kinds.includes(kind) ? [{ signalName, kinds }] : [];
      });
      if (asking !== undefined) {
        const shown = (await service.list(current, projectId)).artifacts.filter(
          (artifact) => asking.kinds.includes(artifact.kind),
        );
        const covered = asking.kinds.every((each) =>
          shown.some(
            (artifact) =>
              artifact.kind === each &&
              artifact.approvedVersion === artifact.version,
          ),
        );
        // As the approve screen answers: each document it asked for, at the version on show.
        if (covered) {
          await answer(c, projectId, asking.signalName, {
            output: {
              approved: shown.map((artifact) => ({
                kind: artifact.kind,
                artifactId: artifact.artifactId,
                version: artifact.version,
              })),
            },
          });
          return c.json({
            artifactId,
            kind,
            version: input.version,
            answered: asking.signalName,
          });
        }
      }
      if (runId !== null)
        await mailRunAsCaller(
          c,
          nativeFetch,
          current.tenantId,
          runId,
          documentApprovedNote(kind, input.version),
        );
      return c.json({ artifactId, kind, version: input.version });
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
        "Uploads one or more files to the project as materials and sends them to the coordinator, with your `message` or, if you leave it out, a short note listing the files. Uploading a file with the same name as an existing material saves it as a new version of that material. The upload is rejected with material_type_not_accepted if the coordinator's model can't read the file type, and with Interchange's attachment error codes if the files are too large or too many.",
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
  app.delete(
    "/:projectId/materials/:artifactId",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "removeMaterial",
      description:
        "Takes an attached file back. The coordinator, when one runs, is told the file is withdrawn first, so a note that cannot be sent leaves the material in place for another try. Then the material is archived, so it leaves the project's documents and the coordinator's filed materials while its versions stay. The message it was sent with keeps showing it. `told` says whether a coordinator was mailed.",
      security,
      responses: {
        200: {
          description: "The material taken back",
          content: {
            "application/json": { schema: resolver(MaterialRemovedReceipt) },
          },
        },
        404: { description: "No such material in this project" },
      },
    }),
    async (c) => {
      const current = actorOf(c);
      return c.json(
        await service.removeMaterial(
          current,
          c.req.param("projectId"),
          c.req.param("artifactId"),
          (runId, content) =>
            mailRunAsCaller(c, nativeFetch, current.tenantId, runId, content),
        ),
      );
    },
  );
  app.post(
    "/:projectId/run-concepts",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "recordRunConcept",
      description:
        "Records the design concept a run the coordinator just deployed works on, before its assignment; the design it files is filed as that concept's design_option.",
      security,
      requestBody: {
        required: true,
        content: {
          "application/json": { schema: resolver(DesignConceptRecord) },
        },
      },
      responses: { 200: { description: "The concept as stored" } },
    }),
    async (c) =>
      c.json(
        await service.recordDesignConcept(
          actorOf(c),
          c.req.param("projectId"),
          await body(c),
        ),
      ),
  );
  app.get(
    "/:projectId/manual",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "readProjectUserManual",
      security,
      responses: {
        200: {
          description:
            "The app's user manual, docs/USER-MANUAL.md, as the live coder keeps it, with the pictures it shows as data URLs; with no coder at work, the one in the saved app (the app repository's main, or the latest filed version of a project without one)",
          content: {
            "application/json": { schema: resolver(UserManual) },
          },
        },
        404: {
          description: "Neither a coder at work nor the saved app has a manual",
        },
        503: { description: "The project's app repository cannot be read" },
      },
    }),
    async (c) => {
      return c.json(await service.manual(actorOf(c), c.req.param("projectId")));
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
            "The live coder's ACCEPTANCE.md, the build plan's acceptance checklist as it ticks items off; with no coder at work, the one in the saved app (the app repository's main, or the latest filed version of a project without one)",
          content: {
            "application/json": { schema: resolver(AcceptanceChecklist) },
          },
        },
        404: {
          description:
            "Neither a coder at work nor the saved app has a checklist",
        },
        503: { description: "The project's app repository cannot be read" },
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
        "Returns the status of the project's running app and, if it is running, the URL where you can open it. While a coder is building, this is the coder's work in progress; otherwise it is the last saved app. This route never starts the app; call keepLiveApp for that. Opening the URL requires the same sign-in and read access to the project as this route.",
      security,
      responses: {
        200: {
          description:
            "Whether the app is running, starting, stopped, failed or has no files yet",
          content: { "application/json": { schema: resolver(LiveApp) } },
        },
        409: {
          description:
            "The project serves no web app to run, as it has no stack.run (no_web_app), or its stack.run is not a run (invalid_stack_run)",
        },
        503: {
          description:
            "This hub does not serve apps, or the project's app repository cannot be read",
        },
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
        "Says the project is open. The hub runs one app per project from its current files, in the coder's sandbox on ports it picks, with the app's own dev script, so every change to those files shows at once. Packages are installed again when they change and a crashed app restarts. It stops once this route has not been called for a minute and starts again on the next call.",
      security,
      responses: {
        200: {
          description: "The app's state after the request",
          content: { "application/json": { schema: resolver(LiveApp) } },
        },
        409: {
          description:
            "The project serves no web app to run, as it has no stack.run (no_web_app), or its stack.run is not a run (invalid_stack_run)",
        },
        503: {
          description:
            "This hub does not serve apps, or the project's app repository cannot be read",
        },
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
        "Saves the files from the most recent coder run as a new version of the project's app, even if the app has not passed its checks or been approved. Files ignored by .gitignore, installed packages, build output and environment files are left out; images and other non-text files are included. If nothing has changed since the latest version, no new version is saved and the latest one is returned.",
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
        "A filed version of the project's app or, without version, the saved app (the app repository's main, or the latest filed version of a project without one), as a zip of its files under one directory named after the project. Installs, build output and environment files are never filed or saved, so they are not in it.",
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
            "No app is saved for this project yet, or no version of that number is filed",
        },
        503: { description: "The project's app repository cannot be read" },
      },
    }),
    async (c) => {
      const { filename, archive } = await service.appArchive(
        actorOf(c),
        c.req.param("projectId"),
        appVersionQuery(c),
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
        "Downloads the project as a zip file named after the project. Use `sections` to choose which folders to include: planning, design, build, or several separated by commas. Leave it out to get all three. The zip always includes project.json, the file the import route reads. The build folder contains the saved app unless you ask for a specific one with `version`.",
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
          description: "The project's zip",
          content: {
            "application/zip": { schema: { type: "string", format: "binary" } },
          },
        },
        400: {
          description:
            "sections names something other than planning, design or build",
        },
        404: { description: "No app version of that number is filed" },
        503: { description: "The project's app repository cannot be read" },
      },
    }),
    async (c) => {
      const query = c.req.query("sections");
      const sections = ExportSection.array()(
        query === undefined ? EXPORT_SECTIONS : query.split(","),
      );
      if (sections instanceof type.errors)
        throw new ProjectError(400, "invalid_export_sections", {
          issues: sections,
        });
      const { filename, archive } = await service.exportArchive(
        actorOf(c),
        c.req.param("projectId"),
        sections,
        appVersionQuery(c),
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
  mountApprovalRoundRoutes(app, service.approvalRounds, nativeFetch);
}
