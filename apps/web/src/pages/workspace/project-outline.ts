/**
 * What the project's sidebar lists: what the project makes, one row for each thing, with where it
 * stands; what files the project has; and how its app stands. It takes the plan, the documents
 * with the design's mockup and concepts, and the live app's state as plain data, and returns them
 * as the sidebar's rows.
 */
import type { PlanView } from "@corbits-builder/schemas/project";
import type { LiveApp } from "@corbits-builder/schemas/artifact";
import { wording } from "../../config.ts";
import { conceptTab } from "./design-concept.ts";
import { DRAFT_TAB, LIVE_TAB, MANUAL_TAB, MOCKUP_TAB } from "./tab-follow.ts";

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

/**
 * One thing the project makes: a document, the app, or what a ready-made plan ends in, such as
 * the app published. It covers the step that makes it and the steps before it that make nothing
 * of their own, such as a question or a check, so the person reads what they are getting rather
 * than every step taken to get it.
 */
export type OutlineRow = {
  /** The step that makes it, or its first step; which keys the row. */
  id: string;
  name: string;
  state: OutlineStepState;
  /**
   * What it is at, when its name alone does not say: the step waiting on the person, failed or
   * under way, while that is not the step that makes it. Null otherwise.
   */
  doing: string | null;
  /** It makes the project's app, so it stands for the app's own line. */
  app: boolean;
  /** The tab of what it made, once the project has it; null while there is nothing to show. */
  opens: string | null;
  /** The steps it covers, whose settings its menu changes. */
  steps: OutlineStep[];
};

export type OutlineFileState = "ready" | "drawing";

export type OutlineFileRow = {
  /** The pane tab the row opens, which names it too. */
  id: string;
  name: string;
  state: OutlineFileState;
  /** A version the person has not opened yet. */
  newVersion: boolean;
};

export type OutlineFile = OutlineFileRow & {
  /** A written document, which prints. */
  printable: boolean;
  /** An attached file, which can be taken out of the project. */
  removable: boolean;
  parts: OutlineFileRow[];
  /** The tab the row opens: its own, or, for a design not filed yet, its first part's. */
  opens: string;
};

export type OutlineAppState =
  | "not_built"
  | "starting"
  | "running"
  | "stopped"
  | "failed";

/** A filed document, as the pane lists it by its kind. */
export type OutlineDocument = {
  id: string;
  title: string;
  unread: boolean;
  /** An attached file. */
  removable: boolean;
  /** Written as text, so it prints. */
  written: boolean;
};

export type OutlineConcept = {
  label: string;
  /** Its designer has filed it. */
  drawn: boolean;
};

export type OutlineInput = {
  plan: PlanView["steps"];
  /** The filed documents the pane shows. */
  documents: readonly OutlineDocument[];
  /** The design's mockup is being drawn and not yet filed. */
  draft: boolean;
  concepts: readonly OutlineConcept[];
  /** The coder has written the app's user manual. */
  manual: boolean;
  app: {
    /** The project has an app the pane can show, built or being built. */
    shown: boolean;
    /** How the hub says it runs; undefined until it has said. */
    state: LiveApp["state"] | undefined;
  };
};

export type Outline = {
  plan: OutlineRow[];
  files: OutlineFile[];
  app: OutlineAppState;
};

// Files follow the project's flow; a kind outside it, such as an attached file, comes last.
const FLOW = [
  "problem_brief",
  "constraints",
  "approaches",
  "product_requirements",
  "design",
  "build_plan",
  "approval_package",
];
const flowRank = (kind: string) => {
  const rank = FLOW.indexOf(kind);
  return rank === -1 ? FLOW.length : rank;
};

function stepState(step: PlanChild): OutlineStepState {
  if (step.declined !== undefined) return "declined";
  switch (step.state) {
    case "done":
    case "failed":
    case "running":
    case "needs_you":
      return step.state;
    case "skipped":
    case "cancelled":
      return "declined";
    case "waiting":
    case "not_started":
      return "to_do";
  }
}

/** A step: where it stands, and which of its settings the person can still change. */
export function outlineStep(step: PlanChild): OutlineStep {
  const declined = step.declined !== undefined;
  const mayAsk =
    !declined &&
    step.cancelled === undefined &&
    (step.state === "waiting" ||
      step.state === "not_started" ||
      step.state === "needs_you");
  const mayDecline =
    declined ||
    (step.optional === true &&
      step.state !== "done" &&
      step.state !== "running");
  return {
    id: step.id,
    name: step.title,
    state: stepState(step),
    askFirst: mayAsk ? step.askFirst : null,
    declined: mayDecline ? declined : null,
  };
}

// A design option is filed under the design, whose row opens what is drawn of it.
const FILED_UNDER: Record<string, string> = { design_option: "design" };

/** What a row covering these steps reads as, from where each of them stands. */
function rowState(
  steps: readonly OutlineStep[],
  maker: OutlineStep | null,
): Pick<OutlineRow, "state" | "doing"> {
  const doing = (step: OutlineStep) => (step === maker ? null : step.name);
  const skipped = (step: OutlineStep) =>
    step.state === "declined" || step.declined === true;
  const live = steps.filter((step) => !skipped(step));
  if (live.length === 0) return { state: "declined", doing: null };
  for (const state of ["needs_you", "failed", "running"] as const) {
    const step = live.find((each) => each.state === state);
    if (step !== undefined) return { state, doing: doing(step) };
  }
  if (live.every((step) => step.state === "done"))
    return { state: "done", doing: null };
  return { state: "to_do", doing: null };
}

/**
 * The plan as the things the project makes, in order. Within a group, each step that makes
 * something closes a row holding it and the steps before it that make nothing; steps after the
 * last such one make the group's own row, named for what its ready-made plan makes. A step outside
 * a group is a row of its own.
 */
export function outlinePlan(
  plan: PlanView["steps"],
  files: readonly OutlineFile[] = [],
  appShown = false,
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const row = (
    steps: readonly PlanChild[],
    maker: PlanChild | null,
    name: string,
  ): OutlineRow => {
    const outlined = steps.map(outlineStep);
    const made = maker?.makes ?? [];
    const app = made.includes("app");
    const tab = app
      ? appShown
        ? LIVE_TAB
        : null
      : (made
          .map((kind) => fileTab(files, FILED_UNDER[kind] ?? kind))
          .find((each) => each !== null) ?? null);
    return {
      id: (maker ?? steps[0]!).id,
      name,
      ...rowState(
        outlined,
        maker === null ? null : (outlined[steps.indexOf(maker)] ?? null),
      ),
      app,
      opens: tab,
      steps: outlined,
    };
  };
  const named = (maker: PlanChild) => {
    const kind = maker.makes?.[0];
    return kind === undefined
      ? maker.title
      : (wording.projectShell.makes[kind] ??
          wording.documentTab[kind] ??
          maker.title);
  };
  for (const entry of plan) {
    if (!("steps" in entry)) {
      rows.push(row([entry], entry, named(entry)));
      continue;
    }
    let waiting: PlanChild[] = [];
    let closed = 0;
    for (const step of entry.steps) {
      waiting.push(step);
      if ((step.makes ?? []).length === 0) continue;
      rows.push(row(waiting, step, named(step)));
      waiting = [];
      closed += 1;
    }
    if (waiting.length === 0) continue;
    // Steps after the group's last thing made: its own row when its plan names what it makes,
    // else part of the row before, else a row named for its last step.
    const last = closed > 0 ? rows.pop() : undefined;
    if (entry.name === undefined && last !== undefined) {
      const steps = entry.steps.slice(
        entry.steps.findIndex((step) => step.id === last.steps[0]!.id),
      );
      const maker = steps.find((step) => step.id === last.id) ?? null;
      rows.push(row(steps, maker, last.name));
      continue;
    }
    if (last !== undefined) rows.push(last);
    rows.push(row(waiting, null, entry.name ?? waiting.at(-1)!.title));
  }
  return rows;
}

const nameOf = (document: OutlineDocument) =>
  wording.documentTab[document.id] ?? document.title;

/**
 * The design's rows: its mockup, drawn with the writing dots while it is a draft, then each
 * concept, with the dots until its designer files it.
 */
function designParts(
  design: OutlineDocument | undefined,
  input: OutlineInput,
): OutlineFileRow[] {
  const mockup: OutlineFileRow | null = input.draft
    ? {
        id: DRAFT_TAB,
        name: wording.design.mockupTab,
        state: "drawing",
        newVersion: false,
      }
    : design === undefined
      ? null
      : {
          id: MOCKUP_TAB,
          name: wording.design.mockupTab,
          state: "ready",
          newVersion: design.unread,
        };
  const concepts = input.concepts.map((concept, index): OutlineFileRow => ({
    id: conceptTab(concept.label),
    name: wording.design.conceptTab(index + 1, concept.label),
    state: concept.drawn ? "ready" : "drawing",
    newVersion: false,
  }));
  return mockup === null ? concepts : [mockup, ...concepts];
}

function documentFile(document: OutlineDocument): OutlineFile {
  return {
    id: document.id,
    name: nameOf(document),
    state: "ready",
    newVersion: document.unread,
    printable: document.written && !document.removable,
    removable: document.removable,
    parts: [],
    opens: document.id,
  };
}

/**
 * Every file the project has, in the project's flow: a row per filed document, the design with its
 * mockup and concepts under it (a design being drawn or chosen has its row before it is filed), the user
 * manual after the build plan, and attached files last.
 */
export function outlineFiles(input: OutlineInput): OutlineFile[] {
  const design = input.documents.find((item) => item.id === "design");
  const parts = designParts(design, input);
  const ranked = input.documents
    .filter((item) => item.id !== "design")
    .map((item) => ({ rank: flowRank(item.id), file: documentFile(item) }));
  if (design !== undefined || parts.length > 0)
    ranked.push({
      rank: flowRank("design"),
      file: {
        id: "design",
        name: wording.documentTab["design"] ?? "design",
        // Unfiled, it is drawn only while a part still is; drawn concepts wait on the person's pick.
        state:
          design === undefined && parts.some((part) => part.state === "drawing")
            ? "drawing"
            : "ready",
        newVersion: design?.unread ?? false,
        printable: false,
        removable: false,
        parts,
        // A design not yet filed has no plan to read, so its row opens what is being drawn.
        opens: design === undefined ? (parts[0]?.id ?? "design") : "design",
      },
    });
  if (input.manual)
    ranked.push({
      // Just after the build plan, before the approval package.
      rank: flowRank("build_plan") + 0.5,
      file: {
        id: MANUAL_TAB,
        name: wording.documentTab["user_manual"] ?? "user_manual",
        state: "ready",
        newVersion: false,
        printable: false,
        removable: false,
        parts: [],
        opens: MANUAL_TAB,
      },
    });
  return ranked
    .map((entry, index) => ({ ...entry, index }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.file);
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
  const files = outlineFiles(input);
  return {
    plan: outlinePlan(input.plan, files, input.app.shown),
    files,
    app: outlineApp(input.app),
  };
}

/** The tab a file row or one of its parts opens; null for an id the outline does not list. */
export function fileTab(files: readonly OutlineFile[], id: string) {
  for (const file of files) {
    if (file.id === id) return file.opens;
    if (file.parts.some((part) => part.id === id)) return id;
  }
  return null;
}
