/**
 * Sample projects as the sidebar's outline reads them: one with no plan, a ready-made plan under
 * way, a plan the coordinator wrote whose steps mostly make nothing, and one whose app runs, for the
 * outline's tests and the room's stories.
 */
import type { PlanView } from "@corbits-builder/schemas/project";
import type { OutlineInput } from "./project-outline.ts";

type PlanChild = Exclude<PlanView["steps"][number], { steps: unknown }>;
type PlanGroup = Extract<PlanView["steps"][number], { steps: unknown }>;

export const planStep = (
  id: string,
  state: PlanChild["state"],
  fields: Partial<PlanChild> = {},
): PlanChild => ({
  id,
  title: id,
  plugin: "writer",
  action: id,
  input: {},
  askFirst: false,
  kind: "workflow",
  state,
  ...fields,
});

export const planGroup = (
  id: string,
  title: string,
  steps: PlanChild[],
  fields: Partial<PlanGroup> = {},
): PlanGroup => ({ id, title, state: "running", steps, ...fields });

/** Something the project view can open, by the kind its tab is named for. */
export const filed = (id: string) => ({ id });

const noApp: OutlineInput["app"] = { shown: false, state: undefined };

/** Opened a moment ago, or asked for something too small to plan: no plan, no files, no app. */
export const newProject: OutlineInput = {
  plan: [],
  documents: [],
  app: noApp,
};

/** A ready-made plan under way: the brief and constraints filed, the approaches being compared. */
export const planning: OutlineInput = {
  plan: [
    planGroup(
      "web-app",
      "Build a web app",
      [
        planStep("brief", "done", {
          title: "Write the brief",
          makes: ["problem_brief"],
        }),
        planStep("constraints", "done", {
          title: "List the constraints",
          makes: ["constraints"],
        }),
        planStep("approaches", "running", {
          title: "Compare approaches",
          makes: ["approaches"],
        }),
        planStep("research", "not_started", {
          title: "Research other bakeries",
          optional: true,
        }),
        planStep("requirements", "needs_you", {
          title: "Write the requirements",
          askFirst: true,
          makes: ["product_requirements"],
        }),
      ],
      { plan: "web-app" },
    ),
  ],
  documents: [filed("problem_brief"), filed("constraints")],
  app: noApp,
};

/**
 * A plan the coordinator wrote from plugin actions, with no ready-made plan: research by a worker,
 * then a coder building a command-line tool. Most of its steps make nothing the project files.
 */
export const coordinatorPlan: OutlineInput = {
  plan: [
    planStep("look", "done", {
      title: "Look at how other bakeries take orders",
      plugin: "worker",
      action: "research",
    }),
    planStep("compare", "done", {
      title: "Compare order formats",
      plugin: "worker",
      action: "research",
    }),
    planStep("ask", "needs_you", {
      title: "Ask which format to read",
      kind: "screen",
      plugin: "worker",
      action: "ask",
    }),
    planStep("tool", "not_started", {
      title: "Build the order import tool",
      plugin: "coder",
      action: "change",
      askFirst: true,
    }),
    planStep("try", "not_started", {
      title: "Try the tool on last week's orders",
      kind: "check",
      plugin: "coder",
      action: "run",
      optional: true,
    }),
  ],
  documents: [],
  app: noApp,
};

/** The app built and running, the manual still being written. */
export const building: OutlineInput = {
  plan: [
    planStep("brief", "done", { makes: ["problem_brief"] }),
    planStep("design", "done", { makes: ["design"] }),
    planStep("build", "done", { makes: ["app"] }),
    planStep("manual", "not_started", { optional: true }),
  ],
  documents: [
    filed("material:menu.pdf"),
    filed("build_plan"),
    filed("design"),
    filed("problem_brief"),
  ],
  app: { shown: true, state: "running" },
};
