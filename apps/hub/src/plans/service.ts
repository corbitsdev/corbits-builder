import { eq } from "drizzle-orm";
import type { DB, DBExecutor } from "@intx/db";
import { principal } from "@intx/db/schema";
import {
  type PlanChildWrite,
  type PlanStepWrite,
  type StoredPlan,
  type StoredPlanChild,
  type StoredPlanGroup,
  type StoredPlanStep,
} from "@corbits-builder/schemas/project";
import { project } from "../db/schema.ts";
import { activeCoordinator } from "../auth/coordinator-registry.ts";
import type { Actor } from "../lib/actor.ts";
import { authorizeProject } from "../projects/authorization.ts";
import { ProjectError } from "../projects/errors.ts";
import {
  STEP_NOT_ASK_FIRST_TEXT,
  STEP_REQUIRED_TEXT,
  stepAskFirstNote,
  stepDeclinedNote,
  stepGoAheadNote,
  stepKeptText,
} from "../config/answers.ts";

// A plan step as stored, under the id it came with or a short new one, with the go-ahead, cancel,
// decline and answer that marksOf says it keeps; only an optional step keeps a decline.
function savedPlanStep(
  step: PlanChildWrite,
  marksOf: (step: PlanChildWrite, id: string) => PlanChildWrite | undefined,
): StoredPlanChild {
  const id = step.id ?? newPlanStepId();
  const marks = marksOf(step, id);
  // Whether a step asks first, may be declined and its gate stay as first saved: a run's save of a
  // stored step keeps them as stored.
  const said = marks ?? step;
  const saved: StoredPlanChild = {
    id,
    title: step.title,
    plugin: step.plugin,
    action: step.action,
    input: step.input,
    askFirst: said.askFirst,
  };
  if (said.optional) saved.optional = said.optional;
  if (said.approval) saved.approval = said.approval;
  if (said.requires) saved.requires = said.requires;
  if (marks?.goAhead) saved.goAhead = marks.goAhead;
  if (marks?.cancelled) saved.cancelled = marks.cancelled;
  if (marks?.declined && saved.optional) saved.declined = marks.declined;
  if (marks?.answered) saved.answered = marks.answered;
  return saved;
}
// A project with no plan saved yet has no steps.
function planActionSteps(plan: StoredPlan | null | undefined) {
  if (!plan) return [];
  return plan.steps.flatMap((step) => ("steps" in step ? step.steps : [step]));
}
const newPlanStepId = () => crypto.randomUUID().slice(0, 12);

// The plan as stored, with its project row locked until the transaction ends so that no other write
// lands between this read and the write made from it.
async function lockedPlan(tx: DBExecutor, projectId: string) {
  const [row] = await tx
    .select({ plan: project.plan })
    .from(project)
    .where(eq(project.id, projectId))
    .for("update");
  return row?.plan;
}
const writePlan = (tx: DBExecutor, projectId: string, plan: StoredPlan) =>
  tx.update(project).set({ plan }).where(eq(project.id, projectId));

export function createPlanService(rawDB: DB["db"]) {
  return {
    // The plan's steps as stored; where each stands is worked out when it is read.
    async projectPlan(
      actor: Actor,
      projectId: string,
    ): Promise<{ steps: StoredPlanStep[]; updatedAt: string | null }> {
      await authorizeProject(rawDB, actor, projectId, "read");
      const [row] = await rawDB
        .select({ plan: project.plan })
        .from(project)
        .where(eq(project.id, projectId));
      return row?.plan ?? { steps: [], updatedAt: null };
    },

    // Replaces the plan with steps already checked against the catalog. Only a person gives a step
    // its go-ahead, cancels it or sets whether it asks first, so a run's save keeps the marks stored
    // under each step's id.
    async savePlan(
      actor: Actor,
      projectId: string,
      steps: readonly PlanStepWrite[],
    ): Promise<StoredPlan> {
      await authorizeProject(rawDB, actor, projectId, "manage");
      const [caller] = await rawDB
        .select({ kind: principal.kind })
        .from(principal)
        .where(eq(principal.id, actor.principalId));
      return rawDB.transaction(async (tx) => {
        const before = new Map(
          planActionSteps(await lockedPlan(tx, projectId)).map((step) => [
            step.id,
            step,
          ]),
        );
        const marksOf = (step: PlanChildWrite, id: string) =>
          caller?.kind === "user" ? step : before.get(id);
        const saved = steps.map((step): StoredPlanStep => {
          if (!("steps" in step)) return savedPlanStep(step, marksOf);
          const group: StoredPlanGroup = {
            id: step.id ?? newPlanStepId(),
            title: step.title,
            steps: step.steps.map((child) => savedPlanStep(child, marksOf)),
          };
          if (step.plan) group.plan = step.plan;
          return group;
        });
        const ids = saved.flatMap((step) => [
          step.id,
          ...("steps" in step ? step.steps : []).map(({ id }) => id),
        ]);
        const repeated = ids.find((id, at) => ids.indexOf(id) !== at);
        if (repeated !== undefined)
          throw new ProjectError(400, "repeated_plan_step", { id: repeated });
        // The person's no and their ask to be consulted are remembered on the plan, so only they can
        // take such a step out of it.
        const dropped = [...before.values()].find(
          (step) => (step.declined || step.askFirst) && !ids.includes(step.id),
        );
        if (caller?.kind !== "user" && dropped)
          throw new ProjectError(409, "kept_plan_step_removed", {
            id: dropped.id,
            text: stepKeptText(dropped.title, dropped.declined !== undefined),
          });
        const plan = { steps: saved, updatedAt: new Date().toISOString() };
        await writePlan(tx, projectId, plan);
        return plan;
      });
    },

    // The person declines an optional plan step, or restores one, and the coordinator is told. Only a
    // person may, and never on a step its ready-made plan requires.
    async declinePlanStep(
      actor: Actor,
      projectId: string,
      stepId: string,
      change: {
        declined: boolean;
        mailRun: (runId: string, content: string) => Promise<void>;
      },
    ) {
      await authorizeProject(rawDB, actor, projectId, "manage");
      const [caller] = await rawDB
        .select({ kind: principal.kind })
        .from(principal)
        .where(eq(principal.id, actor.principalId));
      if (caller?.kind !== "user")
        throw new ProjectError(403, "only_a_person_declines");
      const { plan, title, changed } = await rawDB.transaction(async (tx) => {
        const plan = await lockedPlan(tx, projectId);
        const step = planActionSteps(plan).find(({ id }) => id === stepId);
        if (!plan || !step)
          throw new ProjectError(404, "plan_step_not_found", { id: stepId });
        if (!step.optional)
          throw new ProjectError(409, "plan_step_required", {
            id: stepId,
            text: STEP_REQUIRED_TEXT,
          });
        if (change.declined === (step.declined !== undefined))
          return { plan, title: step.title, changed: false };
        if (change.declined)
          step.declined = {
            by: actor.principalId,
            at: new Date().toISOString(),
          };
        else delete step.declined;
        plan.updatedAt = new Date().toISOString();
        await writePlan(tx, projectId, plan);
        return { plan, title: step.title, changed: true };
      });
      if (!changed) return plan;
      const coordinator = await activeCoordinator(rawDB, projectId);
      if (coordinator)
        await change.mailRun(
          coordinator.runId,
          stepDeclinedNote(title, change.declined),
        );
      return plan;
    },

    // The person answered a screen, which does the plan's first open step for that screen. The
    // answer cannot name its step, since a parked question carries only the screen and its input.
    async answerPlanStep(
      actor: Actor,
      projectId: string,
      screen: { plugin: string; action: string },
    ) {
      await authorizeProject(rawDB, actor, projectId, "manage");
      await rawDB.transaction(async (tx) => {
        const plan = await lockedPlan(tx, projectId);
        const step = planActionSteps(plan).find(
          (each) =>
            each.plugin === screen.plugin &&
            each.action === screen.action &&
            !each.answered &&
            !each.declined &&
            !each.cancelled,
        );
        if (!plan || !step) return;
        const at = new Date().toISOString();
        step.answered = { by: actor.principalId, at };
        plan.updatedAt = at;
        await writePlan(tx, projectId, plan);
      });
    },

    // A person's click adds work to the plan with their go-ahead: a ready-made plan's group, or one
    // action, in place of an earlier one of the same, and the coordinator is told to carry it out.
    async addPlanStep(
      actor: Actor,
      projectId: string,
      step: PlanStepWrite,
      told: {
        note: string;
        mailRun: (runId: string, content: string) => Promise<void>;
      },
    ) {
      await authorizeProject(rawDB, actor, projectId, "manage");
      const at = new Date().toISOString();
      const mark = { by: actor.principalId, at };
      const child = (each: PlanChildWrite) => {
        const saved = savedPlanStep(each, () => undefined);
        saved.goAhead = mark;
        return saved;
      };
      const group = (each: Extract<PlanStepWrite, { steps: unknown }>) => {
        const saved: StoredPlanGroup = {
          id: newPlanStepId(),
          title: each.title,
          steps: each.steps.map(child),
        };
        if (each.plan) saved.plan = each.plan;
        return saved;
      };
      const added = "steps" in step ? group(step) : child(step);
      const same = (each: StoredPlanStep) =>
        "steps" in step
          ? "steps" in each && each.plan === step.plan
          : !("steps" in each) &&
            each.plugin === step.plugin &&
            each.action === step.action;
      const plan = await rawDB.transaction(async (tx) => {
        const stored = (await lockedPlan(tx, projectId)) ?? {
          steps: [],
          updatedAt: at,
        };
        const plan = {
          steps: [...stored.steps.filter((each) => !same(each)), added],
          updatedAt: at,
        };
        await writePlan(tx, projectId, plan);
        return plan;
      });
      await this.tellCoordinator(projectId, told.note, told.mailRun);
      return plan;
    },

    // A hub note to the project's coordinator, when one is running.
    async tellCoordinator(
      projectId: string,
      note: string,
      mailRun: (runId: string, content: string) => Promise<void>,
    ) {
      const coordinator = await activeCoordinator(rawDB, projectId);
      if (coordinator) await mailRun(coordinator.runId, note);
    },

    // The person gives the go-ahead on a step they asked to be consulted on, or turns "ask me
    // first" on or off for a step, and the coordinator is told. Only a person may.
    async askPlanStep(
      actor: Actor,
      projectId: string,
      stepId: string,
      change: {
        ask: { goAhead: true } | { askFirst: boolean };
        mailRun: (runId: string, content: string) => Promise<void>;
      },
    ) {
      await authorizeProject(rawDB, actor, projectId, "manage");
      const [caller] = await rawDB
        .select({ kind: principal.kind })
        .from(principal)
        .where(eq(principal.id, actor.principalId));
      if (caller?.kind !== "user")
        throw new ProjectError(403, "only_a_person_decides");
      const { plan, note } = await rawDB.transaction(async (tx) => {
        const plan = await lockedPlan(tx, projectId);
        const step = planActionSteps(plan).find(({ id }) => id === stepId);
        if (!plan || !step)
          throw new ProjectError(404, "plan_step_not_found", { id: stepId });
        let note: string;
        if ("goAhead" in change.ask) {
          if (!step.askFirst)
            throw new ProjectError(409, "plan_step_not_ask_first", {
              id: stepId,
              text: STEP_NOT_ASK_FIRST_TEXT,
            });
          step.goAhead = {
            by: actor.principalId,
            at: new Date().toISOString(),
          };
          note = stepGoAheadNote(step.title);
        } else {
          if (change.ask.askFirst === step.askFirst)
            return { plan, note: undefined };
          step.askFirst = change.ask.askFirst;
          if (step.askFirst) delete step.goAhead;
          note = stepAskFirstNote(step.title, step.askFirst);
        }
        plan.updatedAt = new Date().toISOString();
        await writePlan(tx, projectId, plan);
        return { plan, note };
      });
      if (note === undefined) return plan;
      const coordinator = await activeCoordinator(rawDB, projectId);
      if (coordinator) await change.mailRun(coordinator.runId, note);
      return plan;
    },
  };
}
