import { isDeepStrictEqual } from "node:util";
import type { Approval, Fact } from "@corbits-builder/plugin";
import type { ReadyPlanOffer } from "@corbits-builder/schemas/project";
import {
  isCheckAction,
  isReadyPlan,
  isScreenAction,
  isWorkflowAction,
  type Catalog,
} from "./catalog.ts";
import { gateOf, makersIn, type Run } from "./coordinator.ts";
import { holds, resolveFacts, unmet } from "./facts.ts";
import { missingTexts, unfinishedText } from "./text.ts";

/**
 * The ready-made plans a project's catalog installs, in their manifests' words, each take-down with
 * what its action tells the person it removes.
 */
export const readyPlanOffers = (catalog: Catalog): ReadyPlanOffer[] =>
  catalog.plugins.filter(isReadyPlan).map(({ builder, description }) => {
    const { takeDown, ends, firstRun } = builder;
    const removes =
      takeDown &&
      catalog.actions
        .filter(isWorkflowAction)
        .find(
          ({ plugin, action }) =>
            plugin === takeDown.plugin && action === takeDown.action,
        )?.removes;
    return {
      handle: builder.handle,
      about: description === "" ? builder.when : description,
      groups: builder.groups,
      plugins: [...new Set(builder.steps.map(({ plugin }) => plugin))],
      ...(ends === undefined ? {} : { ends }),
      ...(firstRun === undefined ? {} : { firstRun }),
      ...(takeDown === undefined
        ? {}
        : { takeDown: removes ? { ...takeDown, removes } : takeDown }),
    };
  });

type Mark = { by: string; at: string };

/** A step of a project's plan as the host stores it: a plugin action with its input. */
export type PlanStep = {
  id: string;
  title: string;
  plugin: string;
  action: string;
  input: Record<string, unknown>;
  askFirst: boolean;
  goAhead?: Mark;
  cancelled?: Mark;
  optional?: boolean;
  approval?: Approval;
  requires?: Fact[];
  declined?: Mark;
  // The person answered the step's screen, which is what doing a screen step is.
  answered?: Mark;
};

/** A step that only groups the steps it holds: it names no action and starts nothing. */
export type PlanGroup = {
  id: string;
  title: string;
  // The ready-made plan the group was added as, by its handle.
  plan?: string;
  steps: readonly PlanStep[];
};

export type StepState =
  | "done"
  | "failed"
  | "running"
  | "needs_you"
  | "waiting"
  | "not_started"
  | "skipped"
  | "cancelled";

/** A plan step with where it stands, worked out from what the host has recorded. */
export type PlanStepView = PlanStep & {
  state: StepState;
  // Done, skipped or cancelled: nothing more will happen to it unless the plan changes.
  finished: boolean;
  kind: "workflow" | "screen" | "check";
  // One plain line: the check's summary, the run's last activity, or why it failed.
  summary?: string;
  evidence?: string[];
  // While it waits, each requirement that does not hold, with what would make it true.
  needs?: string[];
  startedAt?: string;
  endedAt?: string;
  runId?: string;
  checkId?: string;
};

/** A group with where it stands, worked out from its steps. */
export type PlanGroupView = {
  id: string;
  title: string;
  plan?: string;
  state: StepState;
  // Nothing in it is left to do: every step is finished, apart from optional steps nobody started.
  finished: boolean;
  needs?: string[];
  steps: PlanStepView[];
};

/** What the host has recorded of a project, which a plan's state is worked out from. */
export type PlanRecords = {
  // What is true of the project now, a check's facts among it while its latest record stands.
  facts: ReadonlySet<Fact>;
  // The go-ahead facts the person's own answers made true, and whether they decide approvals
  // rather than leaving them to Builder, which a step's approval is held to.
  personFacts: ReadonlySet<Fact>;
  asksApprovals: boolean;
  // The latest record of each check, one for each input it ran on.
  checks: readonly {
    checkId: string;
    plugin: string;
    action: string;
    input: unknown;
    result: "pass" | "fail" | "skipped";
    summary: string;
    evidence: readonly string[];
    current: boolean;
    createdAt: string;
  }[];
  // The runs the coordinator started, newest first, each with the plan step it was started for
  // when the host could tell.
  runs: readonly {
    runId: string;
    plugin: string;
    action: string;
    step?: string;
    status: Run["status"];
    // A live run's state: "approval" while it is held on an approval only the person can give.
    state?: string;
    startedAt: string;
    endedAt?: string;
    lastActivity?: string;
    error?: string;
    // What stopped a run that was blocked.
    blocked?: { reason: string };
  }[];
  // The screens open in front of the person that they have not answered yet.
  questions: readonly { plugin: string; action?: string }[];
};

const DECLINED_SUMMARY = "declined by the person";

const FINISHED: ReadonlySet<StepState> = new Set([
  "done",
  "skipped",
  "cancelled",
]);

// An optional step nobody started leaves nothing to do; one that started keeps its group open.
const leftToDo = (step: PlanStepView) =>
  !step.finished &&
  !(
    step.optional &&
    (step.state === "not_started" || step.state === "waiting")
  );

/**
 * Where each step of a plan stands, worked out from the project's records each time, so the plan
 * never says a step is done when the records say otherwise. A step's run is the one started for it
 * since the person's latest go-ahead to it; a step is done once that run finished with what the step
 * returns true, so a step added, or given the go-ahead again, while an older result exists waits for
 * its own run.
 */
export function planState(
  catalog: Catalog,
  steps: readonly (PlanStep | PlanGroup)[],
  records: PlanRecords,
): (PlanStepView | PlanGroupView)[] {
  const { facts } = records;
  const makers = makersIn(catalog);
  const stepView = (step: PlanStep): PlanStepView => {
    const action = catalog.actions.find(
      (each) => each.plugin === step.plugin && each.action === step.action,
    );
    if (!action)
      throw new Error(
        `The plan names ${step.plugin} ${step.action}, which is not installed`,
      );
    const view: PlanStepView = {
      id: step.id,
      title: step.title,
      plugin: step.plugin,
      action: step.action,
      input: step.input,
      askFirst: step.askFirst,
      state: "not_started",
      finished: false,
      kind: action.kind,
    };
    if (step.goAhead) view.goAhead = step.goAhead;
    if (step.cancelled) view.cancelled = step.cancelled;
    if (step.optional) view.optional = step.optional;
    if (step.approval) view.approval = step.approval;
    if (step.requires) view.requires = step.requires;
    if (step.declined) view.declined = step.declined;
    if (step.answered) view.answered = step.answered;
    const run = records.runs.find(
      (each) =>
        each.step === step.id &&
        (step.goAhead === undefined || each.startedAt >= step.goAhead.at),
    );
    if (run) {
      view.runId = run.runId;
      view.startedAt = run.startedAt;
      if (run.endedAt) view.endedAt = run.endedAt;
      if (run.lastActivity) view.summary = run.lastActivity;
      if (run.error) view.summary = run.error;
      if (run.blocked) view.summary = run.blocked.reason;
    }
    // A check is recorded on its checked input, so the step's is checked the same way to match.
    const checked = isCheckAction(action)
      ? action.validate(step.input)
      : undefined;
    const input = checked?.ok ? checked.input : step.input;
    const record = records.checks.find(
      (each) =>
        each.plugin === step.plugin &&
        each.action === step.action &&
        isDeepStrictEqual(each.input, input),
    );
    if (record) {
      view.checkId = record.checkId;
      view.summary = record.summary;
      view.evidence = [...record.evidence];
      view.endedAt = record.createdAt;
    }
    const own = unmet(
      (action.builder.requires ?? []).map((alternative) =>
        resolveFacts(alternative, step.input),
      ),
      facts,
    );
    const { goAhead } = gateOf(step, records);
    const ready = own.length === 0 && goAhead.length === 0;
    const returns = resolveFacts(action.builder.returns ?? [], step.input);
    const missing = returns.filter((fact) => !holds(fact, facts));
    const done = run?.status === "completed" && missing.length === 0;
    const asked = records.questions.some(
      (each) => each.plugin === step.plugin && each.action === step.action,
    );
    const state = (): StepState => {
      if (step.cancelled) return "cancelled";
      if (step.declined) return "skipped";
      if (step.answered) return "done";
      // A question the person may decline is not put to them once they leave the decisions to Builder.
      if (isScreenAction(action) && step.optional && !records.asksApprovals)
        return "skipped";
      if (record?.result === "skipped" && record.current) return "skipped";
      if (record?.result === "fail") return "failed";
      if (record?.result === "pass" && record.current) return "done";
      if (run?.status === "deployed" || run?.status === "running")
        return run.state === "approval" ? "needs_you" : "running";
      // A blocked run did not fail at the work: the step waits for its cause to be dealt with.
      if (run?.blocked && !done) return "waiting";
      if (run && !done) return "failed";
      if (ready && isScreenAction(action) && asked) return "needs_you";
      if (done) return "done";
      if (ready && step.askFirst && !step.goAhead) return "needs_you";
      if (!ready) return "waiting";
      return "not_started";
    };
    view.state = state();
    view.finished = FINISHED.has(view.state);
    if (view.state === "skipped" && step.declined)
      view.summary = DECLINED_SUMMARY;
    if (view.state === "failed" && run?.status === "completed")
      view.summary = unfinishedText(missing, catalog.factText);
    if (view.state === "waiting")
      view.needs = [
        ...missingTexts(own, makers, catalog.factText),
        ...missingTexts([goAhead], makers, catalog.factText),
      ];
    return view;
  };
  return steps.map((step) => {
    if (!("steps" in step)) return stepView(step);
    const children = step.steps.map(stepView);
    const left = children.filter(leftToDo);
    const view: PlanGroupView = {
      id: step.id,
      title: step.title,
      state: "not_started",
      finished: left.length === 0,
      steps: children,
    };
    if (step.plan) view.plan = step.plan;
    const any = (state: StepState) =>
      children.some((child) => child.state === state);
    const [next] = left;
    if (any("failed")) view.state = "failed";
    else if (any("needs_you")) view.state = "needs_you";
    else if (any("running")) view.state = "running";
    else if (next === undefined) {
      const ended = children.filter((child) => child.finished);
      view.state =
        ended.length > 0 && ended.every((child) => child.state === "cancelled")
          ? "cancelled"
          : "done";
    } else {
      view.state = next.state;
      if (next.needs) view.needs = next.needs;
    }
    return view;
  });
}

/** A step only the person may take out of the plan, with why. */
export type ProtectedStep = {
  step: PlanStepView;
  reason: "approval" | "done" | "started" | "underway";
};

/**
 * The steps of a plan, as planState worked them out, that only the person may take out of it: one
 * waiting for their approval, one running or done, and a required unfinished step of a plan under
 * way. Each group is one plan, and the steps in no group are another. A step the person cancelled is
 * theirs to drop already.
 */
export function protectedSteps(
  steps: readonly (PlanStepView | PlanGroupView)[],
  records: Pick<PlanRecords, "facts" | "personFacts" | "asksApprovals">,
): ProtectedStep[] {
  const plans = [
    steps.flatMap((step) => ("steps" in step ? [] : [step])),
    ...steps.flatMap((step) => ("steps" in step ? [step.steps] : [])),
  ];
  const started = (step: PlanStepView) =>
    step.state === "running" ||
    (step.state === "needs_you" && step.runId !== undefined);
  return plans.flatMap((plan) => {
    // A check's record names no step, so a new step can match an older plan's: only a run started
    // for the step or the person's answer to it says the plan has begun.
    const underway = plan.some(
      (step) => step.runId !== undefined || step.answered !== undefined,
    );
    const reasonOf = (step: PlanStepView): ProtectedStep["reason"] | null => {
      if (step.cancelled) return null;
      if (
        step.approval &&
        step.state !== "done" &&
        gateOf(step, records).goAhead.length > 0
      )
        return "approval";
      if (step.state === "done") return "done";
      if (started(step)) return "started";
      if (underway && !step.optional && !step.finished) return "underway";
      return null;
    };
    return plan.flatMap((step) => {
      const reason = reasonOf(step);
      return reason === null ? [] : [{ step, reason }];
    });
  });
}
