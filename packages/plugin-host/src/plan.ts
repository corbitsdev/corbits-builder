import { isDeepStrictEqual } from "node:util";
import type { Approval, Fact } from "@corbits-builder/plugin";
import { isCheckAction, isScreenAction, type Catalog } from "./catalog.ts";
import { gateOf, makersIn, type Run } from "./coordinator.ts";
import { holds, resolveFacts, unmet } from "./facts.ts";
import { missingTexts, unfinishedText } from "./text.ts";

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
    startedAt: string;
    endedAt?: string;
    lastActivity?: string;
    error?: string;
  }[];
  // The screens open in front of the person that they have not answered yet.
  questions: readonly { plugin: string; action?: string }[];
};

const DECLINED_SUMMARY = "declined by the person";

const settled = ({ state }: PlanStepView) =>
  state === "done" || state === "skipped";

/**
 * Where each step of a plan stands, worked out from the project's records each time, so the plan
 * never says a step is done when the records say otherwise. A run is tied to a step by the step it
 * was started for, or, when the host could not tell which, by its plugin and action alone.
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
      kind: action.builder.runs,
    };
    if (step.goAhead) view.goAhead = step.goAhead;
    if (step.cancelled) view.cancelled = step.cancelled;
    if (step.optional) view.optional = step.optional;
    if (step.approval) view.approval = step.approval;
    if (step.requires) view.requires = step.requires;
    if (step.declined) view.declined = step.declined;
    if (step.answered) view.answered = step.answered;
    const run = records.runs.find((each) =>
      each.step === undefined
        ? each.plugin === step.plugin && each.action === step.action
        : each.step === step.id,
    );
    if (run) {
      view.runId = run.runId;
      view.startedAt = run.startedAt;
      if (run.endedAt) view.endedAt = run.endedAt;
      if (run.lastActivity) view.summary = run.lastActivity;
      if (run.error) view.summary = run.error;
    }
    // A check is recorded on its checked input, so the step's is checked the same way to match.
    const checked = isCheckAction(action)
      ? action.check(step.input)
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
    const done =
      returns.length > 0 ? missing.length === 0 : run?.status === "completed";
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
        return "running";
      if (run && !done) return "failed";
      if (ready && isScreenAction(action) && asked) return "needs_you";
      if (done) return "done";
      if (ready && step.askFirst && !step.goAhead) return "needs_you";
      if (!ready) return "waiting";
      return "not_started";
    };
    view.state = state();
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
    const view: PlanGroupView = {
      id: step.id,
      title: step.title,
      state: "not_started",
      steps: children,
    };
    if (step.plan) view.plan = step.plan;
    const any = (state: StepState) =>
      children.some((child) => child.state === state);
    const next = children.find((child) => !settled(child));
    if (any("failed")) view.state = "failed";
    else if (any("running")) view.state = "running";
    else if (any("needs_you")) view.state = "needs_you";
    else if (next === undefined) view.state = "done";
    else {
      view.state = next.state;
      if (next.needs) view.needs = next.needs;
    }
    return view;
  });
}
