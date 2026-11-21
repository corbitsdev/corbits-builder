import { isDeepStrictEqual } from "node:util";
import { eq } from "drizzle-orm";
import type { DB, DBExecutor } from "@intx/db";
import { isLiveWorkflowRunStatus, principal } from "@intx/db/schema";
import { droppable } from "@corbits-builder/plugin";
import {
  type PlanChildWrite,
  type PlanStepWrite,
  type StoredPlan,
  type StoredPlanChild,
  type StoredPlanGroup,
  type StoredPlanStep,
} from "@corbits-builder/schemas/project";
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
          plan.steps.flatMap((step) =>
            "steps" in step ? step.steps.map(({ id }) => id) : [step.id],
          ),
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
        const actionSteps = saved.flatMap((step) =>
          "steps" in step ? step.steps : [step],
        );
        const removed = kept.find(({ step }) => {
          const now = actionSteps.find(({ id }) => id === step.id);
          return (
            now === undefined ||
            now.plugin !== step.plugin ||
            now.action !== step.action ||
            !isDeepStrictEqual(now.input, step.input)
          );
        });
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

    // The person's answer to a screen cancels the plan steps it names that may still be dropped and
    // stops the jobs started for them, leaving any it does not hold and keeping the mark of one
    // already cancelled. Only a person may.
    async cancelPlanSteps(
      actor: Actor,
      projectId: string,
      stepIds: readonly string[],
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
      const cancelled = read.steps
        .flatMap((each) => ("steps" in each ? each.steps : [each]))
        .filter(({ id, state }) => stepIds.includes(id) && droppable(state));
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
        const named = planActionSteps(plan).filter(
          (step) =>
            cancelled.some(({ id }) => id === step.id) && !step.cancelled,
        );
        if (!plan || named.length === 0) return;
        const at = new Date().toISOString();
        for (const step of named)
          step.cancelled = { by: actor.principalId, at };
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
        const plan = (await lockedPlan(tx, projectId)) ?? {
          steps: [],
          updatedAt: at,
        };
        if (told.goAhead === undefined) {
          const added = savedPlanStep(step, () => undefined);
          added.goAhead = mark;
          plan.steps.push(added);
        } else
          for (const each of planActionSteps(plan))
            if (told.goAhead.includes(each.id)) each.goAhead = mark;
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
