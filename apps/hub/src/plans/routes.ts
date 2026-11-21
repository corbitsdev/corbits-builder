import { isDeepStrictEqual } from "node:util";
import { type } from "arktype";
import type { Context, Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import type { TenantEnv } from "@intx/hub-api";
import { showsScreen } from "@corbits-builder/schemas/conversation";
import {
  PlanView,
  PlanWrite,
  StoredPlan,
} from "@corbits-builder/schemas/project";
import type { Catalog } from "@corbits-builder/plugin-host/catalog";
import { planRefusal } from "@corbits-builder/plugin-host/coordinator";
import { resolveFacts, unmet } from "@corbits-builder/plugin-host/facts";
import {
  planState,
  protectedSteps,
  type PlanRecords,
} from "@corbits-builder/plugin-host/plan";
import { requiresText } from "@corbits-builder/plugin-host/text";
import { actorOf } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import { mailRunAsCaller } from "../mail/caller-mail.ts";
import { askedQuestions } from "../plugins/question.ts";
import type { Checks } from "../plugins/checks.ts";
import { personFacts, projectFacts } from "../plugins/facts.ts";
import { agentDecidesApprovals } from "../config/preferences.ts";
import {
  actionUnmetText,
  taskNote,
  workflowAddedNote,
} from "../config/answers.ts";
import type { createArtifactService } from "../artifacts/service.ts";
import { body, security } from "../http/route-parts.ts";
import { CATALOG, catalogOf, projectCatalog } from "../plugins/catalog.ts";
import type { Actor } from "../lib/actor.ts";
import {
  readProjectValues,
  type ProjectState,
} from "../values/project-values.ts";
import {
  askedScreens,
  projectRead,
  runTask,
  shownScreens,
} from "../plugins/screens.ts";
import type { createValueService } from "../values/service.ts";
import type { createPlanService } from "./service.ts";

const AskFirst = type({ "+": "reject", askFirst: "boolean" });
const ActionRun = type({ "+": "reject", "input?": "Record<string, unknown>" });

// Where each step of the project's plan stands, worked out from what the hub has recorded, with
// the records and questions it was worked out from.
export function planReader(
  service: Pick<ReturnType<typeof createPlanService>, "projectPlan">,
  artifacts: Pick<
    ReturnType<typeof createArtifactService>,
    "list" | "stepRuns"
  >,
  nativeFetch?: (request: Request) => Promise<Response>,
  checks?: Checks,
) {
  return async (c: Context<TenantEnv>, projectId: string, catalog: Catalog) => {
    const current = actorOf(c);
    const plan = await service.projectPlan(current, projectId);
    if (!checks) throw new ProjectError(503, "plan_state_unavailable");
    const { records, appVersion } = await checks.latest(current, projectId);
    const listed = await artifacts.list(current, projectId);
    // Only a person reads the conversation; the coordinator, which asks the questions, cannot be
    // reading the plan while one waits on an answer.
    const asked =
      c.get("principal")?.kind === "user"
        ? (await askedQuestions(c, nativeFetch, projectId)).questions
        : [];
    const facts = projectFacts({
      artifacts: listed.artifacts,
      preferences: listed.preferences,
      checks: records,
    });
    const asking = asked.flatMap((question) =>
      question.status === "open" && showsScreen(question)
        ? [question.asked]
        : [],
    );
    const recorded: PlanRecords = {
      facts,
      personFacts: personFacts(listed.artifacts),
      asksApprovals: !agentDecidesApprovals(listed.preferences),
      checks: records,
      runs: await artifacts.stepRuns(
        current,
        projectId,
        plan.steps.flatMap((step) =>
          "steps" in step ? step.steps.map(({ id }) => id) : [step.id],
        ),
      ),
      questions: asking,
    };
    const steps = planState(catalog, plan.steps, recorded);
    return {
      plan,
      asked,
      recorded,
      read: { facts, steps, appVersion, asking },
    };
  };
}

export function mountPlanRoutes(
  app: Hono<TenantEnv>,
  service: ReturnType<typeof createPlanService>,
  artifacts: ReturnType<typeof createArtifactService>,
  values: Pick<ReturnType<typeof createValueService>, "saveStoredValues">,
  nativeFetch?: (request: Request) => Promise<Response>,
  checks?: Checks,
) {
  const projectView = async (current: Actor, projectId: string) => {
    const state = await artifacts.projectState(current, projectId);
    const catalog = await projectCatalog(async (names) =>
      readProjectValues(names, state, CATALOG.values),
    );
    return { state, catalog };
  };
  const readPlan = planReader(service, artifacts, nativeFetch, checks);
  // What a screen's state or a task reads of the project, as of now.
  const readProject = async (
    current: Actor,
    projectId: string,
    catalog: Catalog,
    state: ProjectState,
    read: Awaited<ReturnType<typeof readPlan>>["read"],
  ) => {
    const [manages, coordinator, runs] = await Promise.all([
      artifacts.managesProject(current, projectId),
      artifacts.coordinatorTurn(current, projectId),
      artifacts.runs(current, projectId),
    ]);
    return projectRead(catalog, {
      state,
      ...read,
      asking: read.asking.map(({ plugin, action }) => ({ plugin, action })),
      now: Date.now(),
      manages,
      coordinator,
      runs,
    });
  };
  app.get(
    "/:projectId/plan",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "readProjectPlan",
      description:
        "The project's saved plan: the plugin actions to run, in order, each with its children; no steps when none was saved. Each step says where it stands, worked out from the project's facts, its checks' latest records, the coordinator's runs and the questions the person has not answered: done, failed, running, needs_you, waiting (with what it needs), not_started, skipped or cancelled. A person's read also lists the screens plugins show on their own, each with its state, where it stands and when the clock alone next changes it. It also gives what the hub prepared for the screens of the coordinator's questions.",
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
      const { state, catalog } = await projectView(current, projectId);
      const { plan, asked, read } = await readPlan(c, projectId, catalog);
      // A screen's state, or what a question's screen draws, may hold what no model may read, so
      // only a person's read works them out. Only a person reads the questions, too.
      const person = c.get("principal")?.kind === "user";
      const project =
        person && (catalog.shown.length > 0 || asked.length > 0)
          ? await readProject(current, projectId, catalog, state, read)
          : undefined;
      return c.json({
        steps: read.steps,
        updatedAt: plan.updatedAt,
        screens: project === undefined ? [] : shownScreens(catalog, project),
        asked:
          project === undefined ? [] : askedScreens(catalog, project, asked),
      });
    },
  );
  app.post(
    "/:projectId/plugins/:plugin/actions/:action",
    describeRoute({
      tags: ["Artifacts"],
      operationId: "runPluginAction",
      description:
        "The signed-in person runs one of a plugin's actions from its screen, refused while what it requires does not hold. A check runs; a workflow joins the plan with the person's go-ahead; a task runs in the hub and saves the values it writes. The coordinator gets one hub note of it.",
      security: [{ sessionCookie: [] }, { deviceBearer: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: resolver(ActionRun) } },
      },
      responses: {
        200: { description: "The action ran" },
        400: { description: "An input the action does not take" },
        403: { description: "The caller is not a person on the project" },
        404: { description: "No task, check or workflow by that name" },
        409: {
          description:
            "What the action requires does not hold, or a task would tell a coordinator that is not running; text says why",
        },
      },
    }),
    async (c) => {
      if (c.get("principal")?.kind !== "user")
        throw new ProjectError(403, "only_a_person_acts");
      if (!checks) throw new ProjectError(503, "plan_state_unavailable");
      const asked = ActionRun(await body(c));
      if (asked instanceof type.errors)
        throw new ProjectError(400, "invalid_action_run", { issues: asked });
      const current = actorOf(c);
      const projectId = c.req.param("projectId");
      const plugin = c.req.param("plugin");
      const name = c.req.param("action");
      const input = asked.input ?? {};
      await service.authorizeAction(current, projectId);
      const { state, catalog } = await projectView(current, projectId);
      const named = (each: { plugin: string; action: string }) =>
        each.plugin === plugin && each.action === name;
      const action = catalog.tasks.find(named) ?? catalog.actions.find(named);
      // A screen opens only as the coordinator's question.
      if (!action || action.kind === "screen")
        throw new ProjectError(404, "action_not_found", {
          plugin,
          action: name,
        });
      // A check is run as the checks route runs it, which checks its input and requires.
      if (action.kind === "check")
        return c.json(
          await checks.run(
            current,
            projectId,
            { plugin, action: name, input },
            {
              triggeredBy: `person:${current.principalId}`,
              waited: false,
              origin: new URL(c.req.url).origin,
            },
          ),
        );
      const checked = action.validate(input);
      if (!checked.ok)
        throw new ProjectError(400, "action_input_refused", {
          text: checked.text,
        });
      const { read } = await readPlan(c, projectId, catalog);
      const { facts, steps } = read;
      const missing = unmet(
        (action.builder.requires ?? []).map((alternative) =>
          resolveFacts(alternative, checked.input),
        ),
        facts,
      );
      if (missing.length > 0)
        throw new ProjectError(409, "action_requirement_unmet", {
          text: actionUnmetText(requiresText(missing, catalog.factText)),
        });
      const mailRun = (runId: string, content: string) =>
        mailRunAsCaller(c, nativeFetch, current.tenantId, runId, content);
      const ran = { plugin, action: name };
      if (action.kind === "workflow") {
        // Planned work runs again under its own step ids, so a click never adds it twice; a step
        // already running is left as it is.
        const planned = steps
          .flatMap((step) => ("steps" in step ? step.steps : [step]))
          .filter(
            (step) =>
              step.plugin === plugin &&
              step.action === name &&
              isDeepStrictEqual(step.input, input),
          );
        await service.addPlanStep(
          current,
          projectId,
          {
            title: action.description,
            plugin,
            action: name,
            input,
            askFirst: false,
          },
          {
            goAhead:
              planned.length === 0
                ? undefined
                : planned
                    .filter(({ state }) => state !== "running")
                    .map(({ id }) => id),
            note: workflowAddedNote(action.description, action.name),
            mailRun,
          },
        );
        return c.json(ran);
      }
      await runTask(
        c,
        projectId,
        catalog,
        {
          task: action,
          read: await readProject(current, projectId, catalog, state, read),
          input: checked.input,
          teller: async () => {
            const tell = await service.coordinatorTeller(projectId, mailRun);
            return tell === undefined
              ? undefined
              : (note) =>
                  tell(taskNote(action.definition.says, action.name, note));
          },
        },
        { artifacts, values },
        nativeFetch,
      );
      return c.json(ran);
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
        409: {
          description:
            "A run's save leaves out or changes a step only the person may take out of the plan; text names the step and says what to do instead",
        },
      },
    }),
    async (c) => {
      const input = PlanWrite(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_plan", { issues: input });
      const current = actorOf(c);
      const projectId = c.req.param("projectId");
      const catalog = await catalogOf(
        artifacts.projectState,
        current,
        projectId,
      );
      const refused = planRefusal(catalog, input.steps);
      if (refused) throw new ProjectError(400, "plan_step_refused", refused);
      return c.json(
        await service.savePlan(current, projectId, input.steps, async () => {
          const { recorded, read } = await readPlan(c, projectId, catalog);
          return protectedSteps(read.steps, recorded);
        }),
      );
    },
  );
  for (const declined of [true, false])
    app.post(
      `/:projectId/plan/steps/:stepId/${declined ? "decline" : "undecline"}`,
      describeRoute({
        tags: ["Artifacts"],
        operationId: declined ? "declinePlanStep" : "undeclinePlanStep",
        description: declined
          ? "The signed-in person declines an optional plan step. The step stays in the plan as skipped, declined by the person, the coordinator cannot start that work while it is declined, and the coordinator gets a hub note saying so. A step its ready-made plan requires cannot be declined."
          : "The signed-in person restores an optional plan step they declined, and the coordinator gets a hub note saying so.",
        security: [{ sessionCookie: [] }, { deviceBearer: [] }],
        responses: {
          200: {
            description: "The plan as now stored",
            content: { "application/json": { schema: resolver(StoredPlan) } },
          },
          403: { description: "The caller is not a person on the project" },
          404: { description: "No plan step by that id" },
          409: {
            description:
              "The step is required by its plan; text says so for the person",
          },
        },
      }),
      async (c) => {
        const current = actorOf(c);
        return c.json(
          await service.declinePlanStep(
            current,
            c.req.param("projectId"),
            c.req.param("stepId"),
            {
              declined,
              mailRun: (runId, content) =>
                mailRunAsCaller(
                  c,
                  nativeFetch,
                  current.tenantId,
                  runId,
                  content,
                ),
            },
          ),
        );
      },
    );
  for (const goAhead of [true, false])
    app.post(
      `/:projectId/plan/steps/:stepId/${goAhead ? "go" : "ask-first"}`,
      describeRoute({
        tags: ["Artifacts"],
        operationId: goAhead ? "goAheadPlanStep" : "askFirstPlanStep",
        description: goAhead
          ? "The signed-in person gives the go-ahead on a plan step they asked to be consulted on, and the coordinator gets a hub note saying so. A step not set to ask first cannot be given one."
          : 'The signed-in person turns "ask me first" on or off for a plan step that has not started. Turning it on clears an earlier go-ahead. The coordinator gets a hub note saying so.',
        security: [{ sessionCookie: [] }, { deviceBearer: [] }],
        responses: {
          200: {
            description: "The plan as now stored",
            content: { "application/json": { schema: resolver(StoredPlan) } },
          },
          400: { description: "The body is not { askFirst: boolean }" },
          403: { description: "The caller is not a person on the project" },
          404: { description: "No plan step by that id" },
          409: {
            description:
              "The step is not set to ask first; text says so for the person",
          },
        },
      }),
      async (c) => {
        const current = actorOf(c);
        const input = goAhead ? { goAhead: true } : AskFirst(await body(c));
        if (input instanceof type.errors)
          throw new ProjectError(400, "invalid_ask_first", { issues: input });
        return c.json(
          await service.askPlanStep(
            current,
            c.req.param("projectId"),
            c.req.param("stepId"),
            {
              ask: "goAhead" in input ? { goAhead: true } : input,
              mailRun: (runId, content) =>
                mailRunAsCaller(
                  c,
                  nativeFetch,
                  current.tenantId,
                  runId,
                  content,
                ),
            },
          ),
        );
      },
    );
}
