import { eq } from "drizzle-orm";
import type { DB, DBExecutor } from "@intx/db";
import { isLiveWorkflowRunStatus, principal } from "@intx/db/schema";
import {
  actionSteps,
  canDrop,
  cancelSteps,
  giveGoAhead,
  markAnswered,
  setAskFirst,
  setDeclined,
  stepById,
  stepIds,
  toStoredStep,
} from "@corbits-builder/plan";
import type {
  PlanChildWrite,
  PlanStepWrite,
  StoredPlan,
  StoredPlanGroup,
  StoredPlanStep,
} from "@corbits-builder/schemas/plan";
import type { ScreenQuestion } from "@corbits-builder/schemas/conversation";
import type { Catalog } from "@corbits-builder/plugin-host/catalog";
import {
  planState,
  protectedSteps,
  type PlanRecords,
  type ProtectedStep,
} from "@corbits-builder/plugin-host/plan";
import type { createArtifactService } from "../artifacts/service.ts";
import type { Checks } from "../plugins/checks.ts";
import { personFacts, projectFacts } from "../plugins/facts.ts";
import { agentDecidesApprovals } from "../config/preferences.ts";
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
  stepProtectedText,
} from "../config/answers.ts";

const newPlanStepId = () => crypto.randomUUID().slice(0, 12);

// The plan as stored, with its project row locked until the transaction ends so that no other write
// lands between this read and the write made from it. A project with no plan saved yet has an empty
// one, whose time the write sets.
async function lockedPlan(
  tx: DBExecutor,
  projectId: string,
): Promise<StoredPlan> {
  const [row] = await tx
    .select({ plan: project.plan })
    .from(project)
    .where(eq(project.id, projectId))
    .for("update");
  return row?.plan ?? { steps: [], updatedAt: new Date().toISOString() };
}
const writePlan = (tx: DBExecutor, projectId: string, plan: StoredPlan) =>
  tx.update(project).set({ plan }).where(eq(project.id, projectId));

export function createPlanService(
  rawDB: DB["db"],
  artifacts: Pick<
    ReturnType<typeof createArtifactService>,
    "list" | "stepRuns" | "runs" | "stopRun"
  >,
  checks?: Checks,
) {
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

    // Where each step of the project's plan stands, worked out from what the hub has recorded and
    // the screens open in front of the person, with the records it was worked out from.
    async readPlan(
      actor: Actor,
      projectId: string,
      catalog: Catalog,
      asking: ScreenQuestion["asked"][],
    ) {
      const plan = await this.projectPlan(actor, projectId);
      if (!checks) throw new ProjectError(503, "plan_state_unavailable");
      const { records, appVersion } = await checks.latest(actor, projectId);
      const listed = await artifacts.list(actor, projectId);
      const facts = projectFacts({
        artifacts: listed.artifacts,
        preferences: listed.preferences,
        checks: records,
      });
      const recorded: PlanRecords = {
        facts,
        personFacts: personFacts(listed.artifacts),
        asksApprovals: !agentDecidesApprovals(listed.preferences),
        checks: records,
        runs: await artifacts.stepRuns(
          actor,
          projectId,
          actionSteps(plan.steps).map(({ id }) => id),
        ),
        questions: asking,
      };
      const steps = planState(catalog, plan.steps, recorded);
      return { plan, recorded, read: { facts, steps, appVersion, asking } };
    },

    // Replaces the plan with steps already checked against the catalog. Only a person gives a step
    // its go-ahead, cancels it or sets whether it asks first, so a run's save keeps the marks stored
    // under each step's id, and may not take out or change a step that only the person may.
    async savePlan(
      actor: Actor,
      projectId: string,
      steps: readonly PlanStepWrite[],
      catalog: Catalog,
    ): Promise<StoredPlan> {
      await authorizeProject(rawDB, actor, projectId, "manage");
      const [caller] = await rawDB
        .select({ kind: principal.kind })
        .from(principal)
        .where(eq(principal.id, actor.principalId));
      let kept: readonly ProtectedStep[] = [];
      if (caller?.kind !== "user") {
        // Only a person reads the conversation, so a run's read has no questions in it.
        const { recorded, read } = await this.readPlan(
          actor,
          projectId,
          catalog,
          [],
        );
        kept = protectedSteps(read.steps, recorded);
      }
      return rawDB.transaction(async (tx) => {
        const before = new Map(
          actionSteps((await lockedPlan(tx, projectId)).steps).map((step) => [
            step.id,
            step,
          ]),
        );
        const stored = (step: PlanChildWrite) => {
          const id = step.id ?? newPlanStepId();
          return toStoredStep(
            step,
            id,
            caller?.kind === "user" ? step : before.get(id),
          );
        };
        const saved = steps.map((step): StoredPlanStep => {
          if (!("steps" in step)) return stored(step);
          const group: StoredPlanGroup = {
            id: step.id ?? newPlanStepId(),
            title: step.title,
            steps: step.steps.map(stored),
          };
          if (step.plan) group.plan = step.plan;
          return group;
        });
        const ids = stepIds(saved);
        const repeated = ids.find((id, at) => ids.indexOf(id) !== at);
        if (repeated !== undefined)
          throw new ProjectError(400, "repeated_plan_step", { id: repeated });
        // The person's no and their ask to be consulted are remembered on the plan, so only they can
        // take such a step out of it.
        const dropped = [...before.values()].find(
          (step) =>
            (step.declined || step.askFirst) &&
            !step.cancelled &&
            !ids.includes(step.id),
        );
        if (caller?.kind !== "user" && dropped)
          throw new ProjectError(409, "kept_plan_step_removed", {
            id: dropped.id,
            text: stepKeptText(dropped.title, dropped.declined !== undefined),
          });
        const removed = kept.find(({ step }) => !ids.includes(step.id));
        if (removed)
          throw new ProjectError(409, "protected_plan_step_removed", {
            id: removed.step.id,
            hint: stepProtectedText(removed.step.title, removed.reason),
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
        const step = stepById(plan.steps, stepId);
        if (!step)
          throw new ProjectError(404, "plan_step_not_found", { id: stepId });
        if (!step.optional)
          throw new ProjectError(409, "plan_step_required", {
            id: stepId,
            text: STEP_REQUIRED_TEXT,
          });
        if (change.declined === (step.declined !== undefined))
          return { plan, title: step.title, changed: false };
        setDeclined(
          step,
          change.declined
            ? { by: actor.principalId, at: new Date().toISOString() }
            : undefined,
        );
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

    // The person's answer to a screen cancels the plan steps it names that may still be dropped and
    // stops the jobs started for them, leaving any it does not hold and keeping the mark of one
    // already cancelled. Only a person may.
    async cancelPlanSteps(
      actor: Actor,
      projectId: string,
      cancelling: readonly string[],
      catalog: Catalog,
    ) {
      await authorizeProject(rawDB, actor, projectId, "manage");
      const [caller] = await rawDB
        .select({ kind: principal.kind })
        .from(principal)
        .where(eq(principal.id, actor.principalId));
      if (caller?.kind !== "user")
        throw new ProjectError(403, "only_a_person_cancels");
      // The screens open in front of the person are left out: an open one only shows a step that has
      // not run as needing them, and that step may be dropped either way.
      const { read } = await this.readPlan(actor, projectId, catalog, []);
      const cancelled = actionSteps(read.steps).filter(
        ({ id, state }) => cancelling.includes(id) && canDrop(state),
      );
      // The jobs stop before the steps are marked, so an answer retried after a failed stop still
      // finds them.
      const live = (await artifacts.runs(actor, projectId)).filter(
        (run) =>
          isLiveWorkflowRunStatus(run.status) &&
          cancelled.some((each) => each.id === run.step),
      );
      for (const run of live)
        try {
          await artifacts.stopRun(actor, projectId, run.runId, "person");
        } catch (error) {
          // A job that ended since it was read has stopped already.
          if (!(error instanceof ProjectError && error.code === "run_ended"))
            throw error;
        }
      await rawDB.transaction(async (tx) => {
        const plan = await lockedPlan(tx, projectId);
        const at = new Date().toISOString();
        const named = cancelSteps(
          plan.steps,
          cancelled.map(({ id }) => id),
          { by: actor.principalId, at },
        );
        if (named.length === 0) return;
        plan.updatedAt = at;
        await writePlan(tx, projectId, plan);
      });
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
        const at = new Date().toISOString();
        if (!markAnswered(plan.steps, screen, { by: actor.principalId, at }))
          return;
        plan.updatedAt = at;
        await writePlan(tx, projectId, plan);
      });
    },

    async authorizeAction(actor: Actor, projectId: string) {
      await authorizeProject(rawDB, actor, projectId, "manage");
    },

    // A click gives the go-ahead to the planned steps that already do its work, else adds a step
    // for it; it never removes or replaces a step.
    async addPlanStep(
      actor: Actor,
      projectId: string,
      step: PlanChildWrite,
      told: {
        goAhead: readonly string[] | undefined;
        note: string;
        mailRun: (runId: string, content: string) => Promise<void>;
      },
    ) {
      await authorizeProject(rawDB, actor, projectId, "manage");
      const at = new Date().toISOString();
      const mark = { by: actor.principalId, at };
      const plan = await rawDB.transaction(async (tx) => {
        const plan = await lockedPlan(tx, projectId);
        if (told.goAhead === undefined) {
          const added = toStoredStep(step, step.id ?? newPlanStepId());
          added.goAhead = mark;
          plan.steps.push(added);
        } else giveGoAhead(plan.steps, told.goAhead, mark);
        plan.updatedAt = at;
        await writePlan(tx, projectId, plan);
        return plan;
      });
      await this.tellCoordinator(projectId, told.note, told.mailRun);
      return plan;
    },

    async tellCoordinator(
      projectId: string,
      note: string,
      mailRun: (runId: string, content: string) => Promise<void>,
    ) {
      await (
        await this.coordinatorTeller(projectId, mailRun)
      )?.(note);
    },

    // How to mail the project's coordinator a note, or undefined while none is running.
    async coordinatorTeller(
      projectId: string,
      mailRun: (runId: string, content: string) => Promise<void>,
    ) {
      const coordinator = await activeCoordinator(rawDB, projectId);
      return coordinator
        ? (note: string) => mailRun(coordinator.runId, note)
        : undefined;
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
        const step = stepById(plan.steps, stepId);
        if (!step)
          throw new ProjectError(404, "plan_step_not_found", { id: stepId });
        let note: string;
        if ("goAhead" in change.ask) {
          if (!step.askFirst)
            throw new ProjectError(409, "plan_step_not_ask_first", {
              id: stepId,
              text: STEP_NOT_ASK_FIRST_TEXT,
            });
          giveGoAhead(plan.steps, [stepId], {
            by: actor.principalId,
            at: new Date().toISOString(),
          });
          note = stepGoAheadNote(step.title);
        } else {
          if (change.ask.askFirst === step.askFirst)
            return { plan, note: undefined };
          setAskFirst(step, change.ask.askFirst);
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
