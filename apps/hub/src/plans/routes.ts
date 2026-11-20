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
  type PlanStepStateName,
} from "@corbits-builder/schemas/project";
import type { Catalog } from "@corbits-builder/plugin-host/catalog";
import { planRefusal } from "@corbits-builder/plugin-host/coordinator";
import { resolveFacts, unmet } from "@corbits-builder/plugin-host/facts";
import { planState } from "@corbits-builder/plugin-host/plan";
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
import { readProjectValues } from "../values/project-values.ts";
import { projectRead, runTask, shownScreens } from "../plugins/screens.ts";
import type { createValueService } from "../values/service.ts";
import type { createPlanService } from "./service.ts";

// A plan step that has not begun, which a click on its action gives the go-ahead instead of adding it again.
const NOT_STARTED: ReadonlySet<PlanStepStateName> = new Set([
  "not_started",
  "waiting",
  "needs_you",
]);
const AskFirst = type({ "+": "reject", askFirst: "boolean" });
const ActionRun = type({ "+": "reject", "input?": "Record<string, unknown>" });

export function mountPlanRoutes(
  app: Hono<TenantEnv>,
  service: ReturnType<typeof createPlanService>,
  artifacts: ReturnType<typeof createArtifactService>,
  values: Pick<ReturnType<typeof createValueService>, "saveStoredValues">,
  nativeFetch?: (request: Request) => Promise<Response>,
  checks?: Checks,
) {
  // The project's stored state, read once, and the catalog as the project sees it.
  const projectView = async (current: Actor, projectId: string) => {
    const state = await artifacts.projectState(current, projectId);
    const catalog = await projectCatalog(async (names) =>
      readProjectValues(names, state, CATALOG.values),
    );
    return { state, catalog };
  };
  const readPlan = async (
    c: Context<TenantEnv>,
    projectId: string,
    catalog: Catalog,
  ) => {
    const current = actorOf(c);
    const plan = await service.projectPlan(current, projectId);
    if (!checks) throw new ProjectError(503, "plan_state_unavailable");
    const records = await checks.latest(current, projectId);
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
    const steps = planState(catalog, plan.steps, {
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
      questions: asked.flatMap((question) =>
        question.status === "open" && showsScreen(question)
          ? [question.asked]
          : [],
      ),
    });
    return { plan, facts, steps };
  };
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
      const projectId = c.req.param("projectId");
      const { state, catalog } = await projectView(actorOf(c), projectId);
      const { plan, facts, steps } = await readPlan(c, projectId, catalog);
      return c.json({
        steps,
        updatedAt: plan.updatedAt,
        // A screen's state may hold what no model may read.
        screens:
          c.get("principal")?.kind === "user"
            ? shownScreens(catalog, projectRead(catalog, state, facts, steps))
            : [],
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
            "What the action requires does not hold; text says what is missing",
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
      const { facts, steps } = await readPlan(c, projectId, catalog);
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
            waiting: steps
              .flatMap((step) => ("steps" in step ? step.steps : [step]))
              .find(
                (step) =>
                  step.plugin === plugin &&
                  step.action === name &&
                  NOT_STARTED.has(step.state) &&
                  isDeepStrictEqual(step.input, input),
              )?.id,
            note: workflowAddedNote(action.description, action.name),
            mailRun,
          },
        );
        return c.json(ran);
      }
      const note = await runTask(
        c,
        projectId,
        catalog,
        {
          task: action,
          read: projectRead(catalog, state, facts, steps),
          input: checked.input,
        },
        { artifacts, values },
        nativeFetch,
      );
      await service.tellCoordinator(
        projectId,
        taskNote(action.definition.says, action.name, note),
        mailRun,
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
      },
    }),
    async (c) => {
      const input = PlanWrite(await body(c));
      if (input instanceof type.errors)
        throw new ProjectError(400, "invalid_plan", { issues: input });
      const current = actorOf(c);
      const projectId = c.req.param("projectId");
      const refused = planRefusal(
        await catalogOf(artifacts.projectState, current, projectId),
        input.steps,
      );
      if (refused) throw new ProjectError(400, "plan_step_refused", refused);
      return c.json(await service.savePlan(current, projectId, input.steps));
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
