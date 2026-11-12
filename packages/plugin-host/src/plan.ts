import { isDeepStrictEqual } from "node:util";
import type { ApprovalWhen, Fact } from "@corbits-builder/plugin";
import { isCheckAction, isScreenAction, type Catalog } from "./catalog.ts";
import { makersIn, type Run } from "./coordinator.ts";
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
  approval?: ApprovalWhen;
  declined?: Mark;
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

/** What the host has recorded of a project, which a plan's state is worked out from. */
export type PlanRecords = {
  // What is true of the project now, a check's facts among it while its latest record stands.
  facts: ReadonlySet<Fact>;
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
  // The runs the coordinator started, newest first.
  runs: readonly {
    runId: string;
    plugin: string;
    action: string;
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
 * never says a step is done when the records say otherwise. A run is tied to a step by its plugin
 * and action alone, since the host does not record the input a run started on.
 */
export function planState(
  catalog: Catalog,
  steps: readonly (PlanStep & { steps?: readonly PlanStep[] })[],
  records: PlanRecords,
): (PlanStepView & { steps?: PlanStepView[] })[] {
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
    if (step.declined) view.declined = step.declined;
    const run = records.runs.find(
      (each) => each.plugin === step.plugin && each.action === step.action,
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
    const ready = own.length === 0;
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
      view.needs = missingTexts(own, makers, catalog.factText);
    return view;
  };
  return steps.map((step) => {
    const view: PlanStepView & { steps?: PlanStepView[] } = stepView(step);
    if (step.steps === undefined) return view;
    const children = step.steps.map(stepView);
    view.steps = children;
    if (step.cancelled) return view;
    const any = (state: StepState) =>
      children.some((child) => child.state === state);
    const next = children.find((child) => !settled(child));
    delete view.needs;
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
