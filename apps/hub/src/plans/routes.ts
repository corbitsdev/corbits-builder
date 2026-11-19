import { type } from "arktype";
import type { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import type { TenantEnv } from "@intx/hub-api";
import { showsScreen } from "@corbits-builder/schemas/conversation";
import {
  PlanView,
  PlanWrite,
  StoredPlan,
} from "@corbits-builder/schemas/project";
import { planRefusal } from "@corbits-builder/plugin-host/coordinator";
import { planState } from "@corbits-builder/plugin-host/plan";
import { actorOf } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import { mailRunAsCaller } from "../mail/caller-mail.ts";
import { askedQuestions } from "../plugins/question.ts";
import type { Checks } from "../plugins/checks.ts";
import { personFacts, projectFacts } from "../plugins/facts.ts";
import { agentDecidesApprovals } from "../config/preferences.ts";
import type { createArtifactService } from "../artifacts/service.ts";
import { body, security } from "../http/route-parts.ts";
import { catalogOf } from "../plugins/catalog.ts";
import type { createPlanService } from "./service.ts";

const AskFirst = type({ "+": "reject", askFirst: "boolean" });

export function mountPlanRoutes(
  app: Hono<TenantEnv>,
  service: ReturnType<typeof createPlanService>,
  artifacts: ReturnType<typeof createArtifactService>,
  nativeFetch?: (request: Request) => Promise<Response>,
  checks?: Checks,
) {
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
      const listed = await artifacts.list(current, projectId);
      // Only a person reads the conversation; the coordinator, which asks the questions, cannot be
      // reading the plan while one waits on an answer.
      const asked =
        c.get("principal")?.kind === "user"
          ? (await askedQuestions(c, nativeFetch, projectId)).questions
          : [];
      return c.json({
        steps: planState(
          await catalogOf(artifacts.projectState, current, projectId),
          plan.steps,
          {
            facts: projectFacts({
              artifacts: listed.artifacts,
              preferences: listed.preferences,
              checks: records,
            }),
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
          },
        ),
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
