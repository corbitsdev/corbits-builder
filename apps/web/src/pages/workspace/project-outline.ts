/**
 * What the project's sidebar lists: the plan the coordinator saved, step by step as it stands, each
 * step linked to what it made once the project has it; and how the project's app stands. It takes
 * the plan, what the project view can open and the live app's state as plain data, and returns them
 * as the sidebar's rows. It knows no plan, plugin or kind of document: whatever the coordinator
 * saved is listed as it is.
 */
import { isDeclined } from "@corbits-builder/plan";
import type { PlanView } from "@corbits-builder/schemas/plan";
import type { LiveApp } from "@corbits-builder/schemas/artifact";
import { wording } from "../../config.ts";
import type { SidebarFile } from "./files-list.tsx";
import { documentViews, type PaneDocument } from "./pane-documents.ts";
import { LIVE_TAB } from "./tab-follow.ts";

type PlanStep = PlanView["steps"][number];
type PlanChild = Exclude<PlanStep, { steps: unknown }>;

export type OutlineStepState =
  | "to_do"
  | "running"
  | "needs_you"
  | "done"
  | "failed"
  | "declined";

export type OutlineStep = {
  id: string;
  name: string;
  state: OutlineStepState;
  /** Builder asks before it starts the step; null once that can no longer change. */
  askFirst: boolean | null;
  /** The person declined the step; null where it cannot be declined. */
  declined: boolean | null;
};

/** One step of the plan. A step that makes nothing is a row as much as one that makes something. */
export type OutlineRow = {
  id: string;
  name: string;
  state: OutlineStepState;
  /** The tab of what it made, once the project has it; null while there is nothing to show. */
  opens: string | null;
  /** When the step started, so a running one can say how long it has run; null before it has. */
  startedAt: string | null;
  /** The run's last activity, or why it failed, in one plain line; null while it has said none. */
  summary: string | null;
  /** The step it is, whose settings its menu changes. */
  steps: OutlineStep[];
};

export type OutlineAppState =
  | "not_built"
  | "starting"
  | "running"
  | "stopped"
  | "failed";

export type OutlineInput = {
  plan: PlanView["steps"];
  /** What the project view can open, each by the kind its tab is named for. */
  documents: readonly { id: string }[];
  app: {
    /** The project has an app the pane can show, built or being built. */
    shown: boolean;
    /** How the hub says it runs; undefined until it has said. */
    state: LiveApp["state"] | undefined;
  };
};

export type Outline = {
  plan: OutlineRow[];
  app: OutlineAppState;
};

function stepState(step: PlanChild): OutlineStepState {
  // Finished without being done means it will not happen.
  if (step.declined !== undefined || (step.finished && step.state !== "done"))
    return "declined";
  switch (step.state) {
    case "done":
    case "failed":
    case "running":
    case "needs_you":
      return step.state;
    default:
      return "to_do";
  }
}

/** A step: where it stands, and which of its settings the person can still change. */
export function outlineStep(step: PlanChild): OutlineStep {
  const declined = isDeclined(step);
  const mayAsk =
    !declined &&
    step.cancelled === undefined &&
    (step.state === "waiting" ||
      step.state === "not_started" ||
      step.state === "needs_you");
  const mayDecline =
    declined ||
    (step.optional === true && !step.finished && step.state !== "running");
  return {
    id: step.id,
    name: step.title,
    state: stepState(step),
    askFirst: mayAsk ? step.askFirst : null,
    declined: mayDecline ? declined : null,
  };
}

/**
 * The plan's steps as the coordinator saved them, in its order, each a row of its own: a ready-made
 * plan's group adds its steps and no row for itself, since the steps say what is happening. A step
 * links to the first thing it makes that the
 * project has: the app once it can be shown, or a document the project view can open.
 */
export function outlinePlan(
  plan: PlanView["steps"],
  documents: OutlineInput["documents"] = [],
  appShown = false,
): OutlineRow[] {
  const filed = new Set(documents.map((item) => item.id));
  const stepRow = (step: PlanChild): OutlineRow => {
    const made = step.makes ?? [];
    const has = (kind: string) => (kind === "app" ? appShown : filed.has(kind));
    const makes = made.find(has) ?? null;
    return {
      id: step.id,
      name: step.title,
      state: stepState(step),
      opens: makes === null ? null : makes === "app" ? LIVE_TAB : makes,
      startedAt: step.startedAt ?? null,
      summary: step.summary ?? null,
      steps: [outlineStep(step)],
    };
  };
  return plan.flatMap((entry) =>
    "steps" in entry ? entry.steps.map(stepRow) : [stepRow(entry)],
  );
}

/**
 * How the app stands: not built while the project has none to show; starting while the hub has not
 * said, since keeping the project open starts it; else as the hub says.
 */
export function outlineApp(app: OutlineInput["app"]): OutlineAppState {
  if (!app.shown) return "not_built";
  return app.state ?? "starting";
}

export function projectOutline(input: OutlineInput): Outline {
  return {
    plan: outlinePlan(input.plan, input.documents, input.app.shown),
    app: outlineApp(input.app),
  };
}

/** The filed documents as Files rows, one for each pane, so a design gets a row for its mockup. */
export function fileRows(documents: readonly PaneDocument[]): SidebarFile[] {
  return documents.flatMap((document) =>
    documentViews(document).map((view) => ({
      id: view.value,
      name:
        view.part === undefined
          ? document.title
          : wording.projectShell.designFile[view.part](document.title),
      opens: view.value,
      files: [],
    })),
  );
}
