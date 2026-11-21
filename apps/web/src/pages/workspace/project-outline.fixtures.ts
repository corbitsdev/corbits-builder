/**
 * Sample projects as the sidebar's outline reads them, from a new project to one whose app runs,
 * for the outline's tests and the room's stories.
 */
import type { PlanView } from "@corbits-builder/schemas/project";
import type { OutlineDocument, OutlineInput } from "./project-outline.ts";

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

export const filed = (
  id: string,
  fields: Partial<OutlineDocument> = {},
): OutlineDocument => ({
  id,
  title: id,
  unread: false,
  removable: false,
  written: true,
  ...fields,
});

const noApp: OutlineInput["app"] = { shown: false, state: undefined };

/** Opened a moment ago: no plan, no files, no app. */
export const newProject: OutlineInput = {
  plan: [],
  documents: [],
  draft: false,
  concepts: [],
  manual: false,
  app: noApp,
};

/** The ready-made plan under way: the brief filed, the constraints filed again since last read. */
export const planning: OutlineInput = {
  plan: [
    planGroup(
      "web-app",
      "Build a web app",
      [
        planStep("brief", "done", { title: "Write the brief" }),
        planStep("constraints", "done", { title: "List the constraints" }),
        planStep("approaches", "running", { title: "Compare approaches" }),
        planStep("research", "not_started", {
          title: "Research other bakeries",
          optional: true,
        }),
        planStep("requirements", "needs_you", {
          title: "Write the requirements",
          askFirst: true,
        }),
      ],
      { plan: "web-app" },
    ),
  ],
  documents: [
    filed("problem_brief", { title: "Problem brief" }),
    filed("constraints", { title: "Constraints", unread: true }),
  ],
  draft: false,
  concepts: [],
  manual: false,
  app: noApp,
};

/** The designer drawing: the mockup still a draft and two concepts, one filed, none chosen. */
export const designing: OutlineInput = {
  ...planning,
  documents: [
    filed("problem_brief"),
    filed("constraints"),
    filed("approaches"),
    filed("product_requirements"),
  ],
  draft: true,
  concepts: [
    { label: "Bold", drawn: true },
    { label: "Calm", drawn: false },
  ],
};

/** The app built and running, with every kind of file the project can have. */
export const building: OutlineInput = {
  plan: [
    planStep("brief", "done"),
    planStep("design", "done"),
    planStep("build", "done"),
    planStep("manual", "not_started", { optional: true }),
  ],
  documents: [
    filed("material:menu.pdf", {
      title: "Spring menu.pdf",
      removable: true,
      written: false,
    }),
    filed("approval_package", { written: false }),
    filed("build_plan"),
    filed("design", { written: false, unread: true }),
    filed("problem_brief"),
  ],
  draft: false,
  concepts: [],
  manual: true,
  app: { shown: true, state: "running" },
};
