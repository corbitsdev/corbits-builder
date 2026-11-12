import { type } from "arktype";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { contentDispositionHeader } from "@corbits/artifacts";
import { PER_MESSAGE_TOTAL_LIMIT_BYTES } from "@intx/types";
import { describeRoute, resolver } from "hono-openapi";
import type { TenantEnv } from "@intx/hub-api";
import { QuestionAnswer } from "@intx/types/signals";
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
  ProjectValues,
  ProjectValuesWrite,
  RunAction,
  RunRecord,
} from "@corbits-builder/schemas/artifact";
import { ProjectActivity } from "@corbits-builder/schemas/activity";
import {
  EXPORT_SECTIONS,
  ExportSection,
  PlanView,
  PlanWrite,
  ProjectExport,
  StoredPlan,
} from "@corbits-builder/schemas/project";
import { planRefusal } from "@corbits-builder/plugin-host/coordinator";
import { planState } from "@corbits-builder/plugin-host/plan";
import { actorOf } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import { readJson } from "../lib/json.ts";
import {
  answerQuestionAsCaller,
  mailRunAsCaller,
} from "../mail/caller-mail.ts";
import { answerRefusedText, documentApprovedNote } from "../config/answers.ts";
import { askedQuestions, openQuestion, screenOf } from "../plugins/question.ts";
import type { Checks } from "../plugins/checks.ts";
import { projectFacts } from "../plugins/facts.ts";
import { mountApprovalRoundRoutes } from "./approval-rounds.ts";
import {
  CATALOG,
  isRoute,
  isWorkflowAction,
  PLUGINS,
  ProjectRoutes,
} from "../plugins/catalog.ts";
import type { createArtifactService } from "./service.ts";
import type { createSettingsService } from "../settings/service.ts";
import { projectValueWrites, readProjectValues } from "./project-values.ts";

const ROUTES = PLUGINS.filter(isRoute).map(({ builder }) => builder.handle);

const undeclaredValue = (names: readonly string[]) =>
  names.find((name) => !CATALOG.values.has(name));

const AnswerPost = type({
  "+": "reject",
  signalName: "string > 0",
  answer: QuestionAnswer,
});

// The question that puts filed documents in front of the person to approve, by their kinds.
const ApproveAsked = type({
  plugin: "'writer'",
  action: "'approve'",
  input: { kinds: "string[]" },
});

const security = [
  { sessionCookie: [] },
  { deviceBearer: [] },
  { coordinatorBearer: [] },
];

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
  nativeFetch?: (request: Request) => Promise<Response>,
  checks?: Checks,
  settings?: ReturnType<typeof createSettingsService>,
) {
  const body = async (c: { req: { json(): Promise<unknown> } }) => {
    const json = await readJson(c.req);
    if (json === undefined) throw new ProjectError(400, "invalid_json");
    return json;
  };
  // The one way project values are saved, from the values route or a screen's answer: each name
  // one the catalog declares, the look values written as design tweaks once a design is filed, the
  // rest stored.
  const saveValues = async (
    c: Context<TenantEnv>,
    projectId: string,
    values: Readonly<Record<string, unknown>>,
  ) => {
    const current = actorOf(c);
    const unknown = undeclaredValue(Object.keys(values));
    if (unknown !== undefined)
      throw new ProjectError(400, "unknown_project_value", { key: unknown });
    const { tokens, stored } = projectValueWrites(
      values,
      await service.projectState(current, projectId),
      CATALOG.values,
    );
    // The tokens first, so a design that cannot take them refuses before anything is stored.
    if (Object.keys(tokens).length > 0)
      await service.saveDesignTweaks(
        current,
        projectId,
        { tokens },
        (runId, content) =>
          mailRunAsCaller(c, nativeFetch, current.tenantId, runId, content),
      );
    if (Object.keys(stored).length > 0)
      await service.saveStoredValues(current, projectId, stored);
  };
  // A screen's answer sets the project preferences it names, saved as Settings saves them, over the
  // project's other preferences.
  const prefer = async (
    c: Context<TenantEnv>,
    projectId: string,
    chosen: Readonly<Record<string, string>>,
  ) => {
    if (!settings) throw new ProjectError(503, "preferences_unavailable");
    const current = actorOf(c);
    const { preferences } = (await settings.read(current, projectId)).fields;
    const saved = await settings.save(current, projectId, {
      command: "save_settings",
      idempotencyKey: crypto.randomUUID(),
      fields: {
        preferences: {
          value: Object.assign({}, preferences?.value, chosen),
          baseVersion: preferences?.version ?? 0,
        },
      },
    });
    if (saved.conflicts.length > 0)
      throw new ProjectError(409, "preferences_changed");
  };
  // The one way the person answers the coordinator's open question, from the answers route or an
  // approval that covers what the question asked: a screen's output saves the values it writes,
  // records what it approves and sets the preferences it names before the answer reaches the run.
  const answer = async (
    c: Context<TenantEnv>,
    projectId: string,
    signalName: string,
    given: typeof QuestionAnswer.infer,
  ) => {
    const current = actorOf(c);
    const { runId, asked } = await openQuestion(
      c,
      nativeFetch,
      projectId,
      signalName,
    );
    const screen = screenOf(asked);
    if (screen !== undefined && "output" in given) {
      const answered = screen.answer(given.output);
      if (!answered.ok)
        throw new ProjectError(400, "answer_refused", {
          text: answerRefusedText(screen.name, answered.refusal),
        });
      const names = Object.keys(answered.values);
      const held =
        names.length === 0
          ? {}
          : readProjectValues(
              names,
              await service.projectState(current, projectId),
            );
      await saveValues(
        c,
        projectId,
        Object.fromEntries(
          Object.entries(answered.values).filter(
            ([name, value]) => held[name] !== value,
          ),
        ),
      );
      if (answered.approves.length > 0)
        await service.approveShown(
          current,
          projectId,
          answered.approves,
          screen.returns("input" in asked ? asked.input : undefined),
          (coordinator, content) =>
            mailRunAsCaller(
              c,
              nativeFetch,
              current.tenantId,
              coordinator,
              content,
            ),
        );
      if (Object.keys(answered.preferences).length > 0)
        await prefer(c, projectId, answered.preferences);
    }
    await answerQuestionAsCaller(
      c,
      nativeFetch,
      { tenantId: current.tenantId, runId },
      signalName,
      given,
    );
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
        "For the calling designer run: the draft the design continues from, with its DESIGN.md. The newest earlier designer run of this project for the same design concept decides: its workspace while it runs, or once it ended unless the concept's design option, or the design without a concept, was filed since; else that filed design at its latest version, with the look the person saved.",
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
    "/:projectId/routes",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "readProjectRoutes",
      description:
        "The handles of the route plugins the project follows, none when it follows none.",
      security,
      responses: {
        200: {
          description: "The routes the project follows",
          content: { "application/json": { schema: resolver(ProjectRoutes) } },
        },
      },
    }),
    async (c) =>
      c.json({
        routes: await service.projectRoutes(
          actorOf(c),
          c.req.param("projectId"),
        ),
      }),
  );
  app.post(
    "/:projectId/routes",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "followProjectRoutes",
      description:
        "Sets the installed route plugins the project follows, by their handles; none takes it off every route.",
      security,
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(ProjectRoutes) } },
      },
      responses: {
        200: {
          description: "The routes the project now follows",
          content: { "application/json": { schema: resolver(ProjectRoutes) } },
        },
        400: { description: "A handle that is not an installed route plugin" },
      },
    }),
    async (c) => {
      const input = ProjectRoutes(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_project_routes", {
          issues: input,
        });
      const unknown = input.routes.find((route) => !ROUTES.includes(route));
      if (unknown !== undefined)
        throw new ProjectError(400, "unknown_route", { route: unknown });
      return c.json({
        routes: await service.followRoutes(
          actorOf(c),
          c.req.param("projectId"),
          input.routes,
        ),
      });
    },
  );
  app.get(
    "/:projectId/plan",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "readProjectPlan",
      description:
        "The project's saved plan: the plugin actions to run, in order, each with its children; no steps when none was saved. Each step says where it stands, worked out from the project's facts, its checks' latest records, the coordinator's runs and the questions the person has not answered: done, failed, running, needs_you, waiting (with what it needs), not_started, skipped or cancelled.",
      security,
      responses: {
        200: {
          description: "The saved plan, each step with where it stands",
          content: { "application/json": { schema: resolver(PlanView) } },
        },
        503: { description: "The hub cannot read the project's records" },
      },
    }),
    async (c) => {
      const current = actorOf(c);
      const projectId = c.req.param("projectId");
      const plan = await service.projectPlan(current, projectId);
      if (!checks) throw new ProjectError(503, "plan_state_unavailable");
      const records = await checks.latest(current, projectId);
      const listed = await service.list(current, projectId);
      // Only a person reads the conversation; the coordinator, which asks the questions, cannot be
      // reading the plan while one waits on an answer.
      const asked =
        c.get("principal")?.kind === "user"
          ? (await askedQuestions(c, nativeFetch, projectId)).questions
          : [];
      return c.json({
        steps: planState(CATALOG, plan.steps, {
          facts: projectFacts({
            artifacts: listed.artifacts,
            preferences: listed.preferences,
            checks: records,
          }),
          checks: records,
          runs: await service.runs(current, projectId),
          questions: asked.flatMap(({ asked: question, answer }) =>
            answer === undefined && "plugin" in question ? [question] : [],
          ),
        }),
        updatedAt: plan.updatedAt,
      });
    },
  );
  app.put(
    "/:projectId/plan",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "saveProjectPlan",
      description:
        "Replaces the project's plan. Every step's plugin and action must be installed and its input must fit that action; what the action requires need not hold yet. A step saved without an id gets one. Only a person gives a step its go-ahead or cancels it: a run's save keeps those already stored under each step's id and ignores any it sends.",
      security,
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(PlanWrite) } },
      },
      responses: {
        200: {
          description: "The plan as now stored",
          content: { "application/json": { schema: resolver(StoredPlan) } },
        },
        400: {
          description:
            "A step the catalog refuses; text names the step and says what is wrong and what to do",
        },
      },
    }),
    async (c) => {
      const input = PlanWrite(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_plan", { issues: input });
      const refused = planRefusal(CATALOG, input.steps);
      if (refused) throw new ProjectError(400, "plan_step_refused", refused);
      return c.json(
        await service.savePlan(
          actorOf(c),
          c.req.param("projectId"),
          input.steps,
        ),
      );
    },
  );
  app.post(
    "/:projectId/run-actions",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "recordRunAction",
      description:
        "Records the plugin action the coordinator just started a specialist run for, before the run's assignment reaches it. The run is then listed among the coordinator's runs, the coordinator may stop it, and it may save the project values that action writes.",
      security,
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(RunAction) } },
      },
      responses: {
        200: {
          description: "The recorded run and action",
          content: { "application/json": { schema: resolver(RunAction) } },
        },
        404: { description: "No specialist run by that id in the project" },
      },
    }),
    async (c) =>
      c.json(
        await service.recordRunAction(
          actorOf(c),
          c.req.param("projectId"),
          await body(c),
        ),
      ),
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
        "Stops a run the coordinator started in the project, through Interchange's cancellation. What the run filed or pushed before it stopped is kept.",
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
        ),
      ),
  );
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
        400: {
          description:
            "A name that no plugin declares or a value its type refuses",
        },
        403: {
          description: "A value the run's action does not write",
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
      const unknown = undeclaredValue(Object.keys(input.values));
      if (unknown !== undefined)
        throw new ProjectError(400, "unknown_project_value", {
          key: unknown,
          issues: [
            { path: unknown, message: "is not a value any plugin declares" },
          ],
        });
      // Refuses a value its declared type does not take. Every value an action writes is one a
      // plugin declares, kept in the plain store, so the values are stored as they came.
      projectValueWrites(
        input.values,
        await service.projectState(current, projectId),
        CATALOG.values,
      );
      await service.saveRunValues(current, projectId, input.values, (run) => {
        const action = CATALOG.actions
          .filter(isWorkflowAction)
          .find(
            (installed) =>
              installed.plugin === run.plugin &&
              installed.action === run.action,
          );
        return action?.builder.writes ?? [];
      });
      return c.json({
        values: readProjectValues(
          Object.keys(input.values),
          await service.projectState(current, projectId),
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
        "The project values named in keys, comma separated, each read from its home: the look values from the filed design's styles.css once a design is filed, and before that, like every other declared value, from the project's own store. A value the project has none of yet is null. Without keys, every declared value, with declared saying what each holds and the types it takes.",
      security,
      responses: {
        200: {
          description: "Each named value, or null",
          content: { "application/json": { schema: resolver(ProjectValues) } },
        },
        400: { description: "A key that no plugin declares" },
      },
    }),
    async (c) => {
      const keys = c.req.query("keys");
      const state = await service.projectState(
        actorOf(c),
        c.req.param("projectId"),
      );
      if (keys === undefined)
        return c.json({
          values: readProjectValues([...CATALOG.values.keys()], state),
          declared: Object.fromEntries(
            [...CATALOG.values].map(([name, declaration]) => [
              name,
              { about: declaration.about, types: [declaration.type].flat() },
            ]),
          ),
        });
      const names = keys.split(",");
      const unknown = undeclaredValue(names);
      if (unknown !== undefined)
        throw new ProjectError(400, "unknown_project_value", { key: unknown });
      return c.json({ values: readProjectValues(names, state) });
    },
  );
  app.post(
    "/:projectId/values",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "saveProjectValues",
      description:
        "Saves project values by name, each checked against its declared type and written to its home: once a design is filed, the look values become design tweaks with the stored fallbacks kept, saved as design-tweaks saves them; before that, and for every other value, they go to the project's own store. Returns the saved values read back.",
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
      await saveValues(c, projectId, input.values);
      const state = await service.projectState(current, projectId);
      return c.json({
        values: readProjectValues(Object.keys(input.values), state),
      });
    },
  );
  app.post(
    "/:projectId/answers",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "answerQuestion",
      description:
        "The signed-in person answers the question the project's coordinator is waiting on, by its signal name: a question card's answers, a screen's output, or a reply they typed instead. For a screen's output the hub checks it against the screen's output schema, saves the project values the screen writes from it where they changed, and records what it approves: a document's approval at the version shown, or the design option chosen as the design, each only among the facts the question allows; and sets the project preferences the screen sets from it, such as leaving approvals to Builder. Then it delivers the answer to the run through Interchange's signal route as the person. A reply is delivered as it is.",
      security: [{ sessionCookie: [] }, { deviceBearer: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(AnswerPost) } },
      },
      responses: {
        200: { description: "The answer was recorded and delivered" },
        400: {
          description:
            "The output does not fit the screen; text says, for the person, each part that is wrong and that the question is still open",
        },
        403: { description: "The caller is not a person on the project" },
        404: { description: "No open question by that signal name" },
        409: {
          description:
            "The question was answered already, or the answer approves what was not asked or a version that is no longer the newest",
        },
      },
    }),
    async (c) => {
      const input = AnswerPost(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_answer", { issues: input });
      await answer(c, c.req.param("projectId"), input.signalName, input.answer);
      return c.json({ signalName: input.signalName });
    },
  );
  app.post(
    "/:projectId/artifacts/:artifactId/approval",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "approveDocument",
      description:
        "The signed-in person approves a filed document at the version they read, with no question asking for it. The hub records the approval of exactly that version as an approve screen's answer records it. When the coordinator is waiting on an approve question whose documents this approval now completes, the hub answers that question as the approve screen would, at each document's current version; otherwise it leaves any such question open and sends the coordinator a hub note naming the document and version.",
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
        [`approved:${kind}`],
        (coordinator, content) =>
          mailRunAsCaller(
            c,
            nativeFetch,
            current.tenantId,
            coordinator,
            content,
          ),
      );
      // The open approve question that asks for this document too, with every kind it asks for.
      const [asking] = questions.flatMap(({ signalName, asked, answer }) => {
        const approve = ApproveAsked(asked);
        return answer === undefined &&
          !(approve instanceof type.errors) &&
          approve.input.kinds.includes(kind)
          ? [{ signalName, kinds: approve.input.kinds }]
          : [];
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
  app.delete(
    "/:projectId/materials/:artifactId",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "removeMaterial",
      description:
        "Takes an attached file back. The coordinator, when one runs, is told the file is withdrawn first, so a note that cannot be sent leaves the material in place for another try; then the material is archived, so it leaves the project's documents and the coordinator's filed materials while its versions stay. The message it was sent with keeps showing it. `told` says whether a coordinator was mailed.",
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
    "/:projectId/run-records",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "recordRun",
      description:
        "Records data against a run a plugin's starter just deployed, before its assignment: the concept it works on (its design is filed as that concept's design_option), or the sources a presentation pins.",
      security,
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(RunRecord) } },
      },
      responses: { 200: { description: "The record as stored" } },
    }),
    async (c) => {
      const input = RunRecord(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_run_record", {
          issues: input.summary,
        });
      const projectId = c.req.param("projectId");
      if (input.name === "concept")
        return c.json(
          await service.recordDesignConcept(actorOf(c), projectId, {
            runId: input.runId,
            concept: input.data,
          }),
        );
      return c.json(
        await service.recordPresenterAssignment(actorOf(c), projectId, {
          runId: input.runId,
          assignment: input.data,
        }),
      );
    },
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
        "The project's app as the hub runs it while the project is open, from the project's current files: the build workspace's while a coder builds, else the saved app (the app repository's main, or the latest filed version of a project without one). Reading never starts it. A running app is served at url, an origin of its own on this host whose every request needs the same session and project read access as this route.",
      security,
      responses: {
        200: {
          description:
            "Whether the app is running, starting, stopped, failed or has no files yet",
          content: { "application/json": { schema: resolver(LiveApp) } },
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
        "Says the project is open. The hub runs one app per project from its current files, in the coder's sandbox on ports it picks, with the app's own dev script, so every change to those files shows at once; packages are installed again when they change and a crashed app restarts. It stops once this route has not been called for a minute and starts again on the next call.",
      security,
      responses: {
        200: {
          description: "The app's state after the request",
          content: { "application/json": { schema: resolver(LiveApp) } },
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
        "The project as a zip named after it. sections (comma-separated planning, design, build; all when absent) picks planning/ (each document as <kind>.md and the person's materials), design/ (the design's files and each option's under options/<label>/) and build/ (the app's source). project.json, the file import reads, is always in it. The app in build/ is the filed version named by version, else the saved app.",
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
