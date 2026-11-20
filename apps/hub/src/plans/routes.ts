import { isDeepStrictEqual } from "node:util";
import { type } from "arktype";
import type { Context, Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import type { TenantEnv } from "@intx/hub-api";
import { getLogger } from "@intx/log";
import { showsScreen } from "@corbits-builder/schemas/conversation";
import {
  PlanView,
  PlanWrite,
  StoredPlan,
  type PlanStepWrite,
  type StoredPlanChild,
  type StoredPlanGroup,
} from "@corbits-builder/schemas/project";
import type { PlanAdd } from "@corbits-builder/plugin";
import {
  isReadyPlan,
  type Catalog,
} from "@corbits-builder/plugin-host/catalog";
import {
  isReadyPlanGroup,
  planRefusal,
  readyPlanStep,
} from "@corbits-builder/plugin-host/coordinator";
import { unmet } from "@corbits-builder/plugin-host/facts";
import { planState } from "@corbits-builder/plugin-host/plan";
import { requiresText } from "@corbits-builder/plugin-host/text";
import { actorOf } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import { mailRunAsCaller } from "../mail/caller-mail.ts";
import { askedQuestions } from "../plugins/question.ts";
import type { Checks } from "../plugins/checks.ts";
import { personFacts, projectFacts } from "../plugins/facts.ts";
import { agentDecidesApprovals } from "../config/preferences.ts";
import { actionNote, actionUnmetText } from "../config/answers.ts";
import {
  savedAppVersion,
  type createArtifactService,
} from "../artifacts/service.ts";
import { body, security } from "../http/route-parts.ts";
import type { Actor } from "../lib/actor.ts";
import { CATALOG, catalogOf, projectCatalog } from "../plugins/catalog.ts";
import { projectRead, runTask, shownScreens } from "../plugins/screens.ts";
import {
  readProjectValues,
  type ProjectState,
} from "../values/project-values.ts";
import type { createValueService } from "../values/service.ts";
import type { createPlanService } from "./service.ts";

const log = getLogger(["corbits-builder", "hub", "plans"]);

// Where a planned step stands while its work has not begun.
const NOT_BEGUN: ReadonlySet<string> = new Set([
  "not_started",
  "waiting",
  "needs_you",
]);

const AskFirst = type({ "+": "reject", askFirst: "boolean" });
const ActionRun = type({ "+": "reject", "input?": "Record<string, unknown>" });

// The plan step a task adds: a ready-made plan's group, or one action; none when it adds nothing.
function added(
  catalog: Catalog,
  adds: PlanAdd | undefined,
): PlanStepWrite | undefined {
  if (adds === undefined) return undefined;
  if (!("plan" in adds))
    return {
      title: adds.title,
      plugin: adds.plugin,
      action: adds.action,
      input: {},
      askFirst: false,
    };
  const ready = catalog.installed(adds.plan);
  if (ready === undefined || !isReadyPlan(ready))
    throw new ProjectError(400, "plan_not_installed", { plan: adds.plan });
  return readyPlanStep(ready);
}

// The planned steps a click gives the go-ahead instead of adding its work again, none when its work
// is not planned: the steps of the group its ready-made plan was added as, bar those running, since
// that plan is on the plan at most once; or the same action with the same input not yet begun.
function plannedSteps(steps: PlanView["steps"], step: PlanStepWrite) {
  if ("steps" in step) {
    const { plan } = step;
    const group = steps.find(
      (each) => plan !== undefined && isReadyPlanGroup(each, plan),
    );
    if (group === undefined || !("steps" in group)) return undefined;
    return group.steps
      .filter(({ state }) => state !== "running")
      .map(({ id }) => id);
  }
  const planned = steps
    .flatMap((each) => ("steps" in each ? each.steps : [each]))
    .find(
      (each) =>
        each.plugin === step.plugin &&
        each.action === step.action &&
        NOT_BEGUN.has(each.state) &&
        isDeepStrictEqual(each.input, step.input),
    );
  return planned === undefined ? undefined : [planned.id];
}

/**
 * The stored plan's steps whose actions are still installed, so a plan saved before a plugin dropped
 * an action still reads; a group left with no steps goes too. The stored plan keeps them.
 */
function installedSteps(
  catalog: Catalog,
  projectId: string,
  steps: StoredPlan["steps"],
): StoredPlan["steps"] {
  const installed = (step: StoredPlanChild) => {
    const found = catalog.actions.some(
      (each) => each.plugin === step.plugin && each.action === step.action,
    );
    if (!found)
      log.warn("A stored plan step names an action that is not installed", {
        projectId,
        plugin: step.plugin,
        action: step.action,
      });
    return found;
  };
  return steps.flatMap((step): StoredPlan["steps"] => {
    if (!("steps" in step)) return installed(step) ? [step] : [];
    const kept = step.steps.filter(installed);
    if (kept.length === 0) return [];
    const group: StoredPlanGroup = {
      id: step.id,
      title: step.title,
      steps: kept,
    };
    if (step.plan) group.plan = step.plan;
    return [group];
  });
}

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
  // The plan with where each step stands, and what that was worked out from.
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
    const stored = installedSteps(catalog, projectId, plan.steps);
    const facts = projectFacts({
      artifacts: listed.artifacts,
      preferences: listed.preferences,
      checks: records,
    });
    const steps = planState(catalog, stored, {
      facts,
      personFacts: personFacts(listed.artifacts),
      asksApprovals: !agentDecidesApprovals(listed.preferences),
      checks: records,
      runs: await artifacts.stepRuns(
        current,
        projectId,
        stored.flatMap((step) =>
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
  // The project as a screen's state and a task read it.
  const readProject = async (
    current: Actor,
    projectId: string,
    view: { state: ProjectState; catalog: Catalog },
    planned: {
      facts: ReturnType<typeof projectFacts>;
      steps: PlanView["steps"];
    },
  ) => {
    const app = await artifacts.savedApp(current, projectId);
    return projectRead(
      view.catalog,
      view.state,
      app === undefined ? undefined : savedAppVersion(app),
      planned.facts,
      planned.steps,
    );
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
      const current = actorOf(c);
      const projectId = c.req.param("projectId");
      const view = await projectView(current, projectId);
      const planned = await readPlan(c, projectId, view.catalog);
      return c.json({
        steps: planned.steps,
        updatedAt: planned.plan.updatedAt,
        // A screen's state may hold what no model may read.
        screens:
          c.get("principal")?.kind === "user"
            ? shownScreens(
                view.catalog,
                await readProject(current, projectId, view, planned),
              )
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
        "The signed-in person runs one of a plugin's actions from its screen, refused while what the action requires does not hold. A task runs in the hub: it saves the values it writes and may add work to the plan with the person's go-ahead. A check runs against the project as saved. A workflow is added to the plan with the person's go-ahead. The coordinator gets a hub note saying what happened, so it carries the work out without asking again.",
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
      const origin = new URL(c.req.url).origin;
      await service.authorizeAction(current, projectId);
      const view = await projectView(current, projectId);
      const { catalog } = view;
      const named = (each: { plugin: string; action: string }) =>
        each.plugin === plugin && each.action === name;
      const action = catalog.tasks.find(named) ?? catalog.actions.find(named);
      // A screen opens only as the coordinator's question.
      if (!action || action.kind === "screen")
        throw new ProjectError(404, "action_not_found", {
          plugin,
          action: name,
        });
      if (action.kind === "check")
        return c.json(
          await checks.run(
            current,
            projectId,
            { plugin, action: name, input },
            {
              triggeredBy: `person:${current.principalId}`,
              waited: false,
              origin,
            },
          ),
        );
      const planned = await readPlan(c, projectId, catalog);
      const missing = unmet(action.builder.requires ?? [], planned.facts);
      if (missing.length > 0)
        throw new ProjectError(409, "action_requirement_unmet", {
          text: actionUnmetText(requiresText(missing, catalog.factText)),
        });
      const checked = action.validate(input);
      if (!checked.ok)
        throw new ProjectError(400, "action_input_refused", {
          text: checked.text,
        });
      const mailRun = (runId: string, content: string) =>
        mailRunAsCaller(c, nativeFetch, current.tenantId, runId, content);
      const ran = { plugin, action: name };
      if (action.kind === "workflow") {
        const step = {
          title: action.description,
          plugin,
          action: name,
          input,
          askFirst: false,
        };
        await service.addPlanStep(current, projectId, step, {
          goAhead: plannedSteps(planned.steps, step),
          note: actionNote(
            `The person gave the go-ahead for "${action.description}".`,
            action.name,
            undefined,
            action.description,
          ),
          mailRun,
        });
        return c.json(ran);
      }
      const done = await runTask(
        c,
        projectId,
        catalog,
        {
          task: action,
          read: await readProject(current, projectId, view, planned),
          input: checked.input,
        },
        { artifacts, values },
        nativeFetch,
      );
      // The checks that follow what was saved stand again before the coordinator reads the one note
      // of this action.
      await checks.changed(current, projectId, origin, true);
      const step = added(catalog, done.adds);
      if (step === undefined) {
        await service.tellCoordinator(
          projectId,
          actionNote(action.says, action.name, done.note, undefined),
          mailRun,
        );
        return c.json(ran);
      }
      const refused = planRefusal(catalog, [step]);
      if (refused) throw new ProjectError(400, "plan_step_refused", refused);
      await service.addPlanStep(current, projectId, step, {
        goAhead: plannedSteps(planned.steps, step),
        note: actionNote(action.says, action.name, done.note, step.title),
        mailRun,
      });
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
