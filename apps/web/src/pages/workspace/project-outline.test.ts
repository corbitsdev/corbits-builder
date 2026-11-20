import { describe, expect, test } from "bun:test";
import { wording } from "../../config.ts";
import { conceptTab } from "./design-concept.ts";
import { DRAFT_TAB, MANUAL_TAB, MOCKUP_TAB } from "./tab-follow.ts";
import {
  building,
  designing,
  filed,
  newProject,
  planGroup,
  planning,
  planStep,
} from "./project-outline.fixtures.ts";
import {
  fileTab,
  outlineApp,
  outlinePlan,
  outlineStep,
  projectOutline,
} from "./project-outline.ts";

describe("a step's row", () => {
  test("reads the hub's state as the sidebar marks it", () => {
    const state = (hub: Parameters<typeof planStep>[1]) =>
      outlineStep(planStep("step", hub)).state;
    expect(state("done")).toBe("done");
    expect(state("running")).toBe("running");
    expect(state("needs_you")).toBe("needs_you");
    expect(state("failed")).toBe("failed");
    expect(state("waiting")).toBe("to_do");
    expect(state("not_started")).toBe("to_do");
    expect(state("skipped")).toBe("declined");
    expect(state("cancelled")).toBe("declined");
  });

  test("a declined step reads declined whatever the hub worked out", () => {
    const step = planStep("research", "not_started", {
      optional: true,
      declined: { by: "person", at: "2026-11-20T10:00:00Z" },
    });
    expect(outlineStep(step)).toMatchObject({
      state: "declined",
      declined: true,
      askFirst: null,
    });
  });

  test("ask me first can change only before the step starts", () => {
    const askFirst = (state: Parameters<typeof planStep>[1]) =>
      outlineStep(planStep("step", state, { askFirst: true })).askFirst;
    expect(askFirst("not_started")).toBe(true);
    expect(askFirst("waiting")).toBe(true);
    expect(askFirst("needs_you")).toBe(true);
    expect(askFirst("running")).toBeNull();
    expect(askFirst("done")).toBeNull();
    expect(askFirst("failed")).toBeNull();
    const cancelled = planStep("step", "not_started", {
      cancelled: { by: "coordinator", at: "2026-11-20T10:00:00Z" },
    });
    expect(outlineStep(cancelled).askFirst).toBeNull();
  });

  test("only an optional step that has not run or finished can be declined", () => {
    const declined = (
      state: Parameters<typeof planStep>[1],
      optional: boolean,
    ) => outlineStep(planStep("step", state, { optional })).declined;
    expect(declined("not_started", true)).toBe(false);
    expect(declined("failed", true)).toBe(false);
    expect(declined("running", true)).toBeNull();
    expect(declined("done", true)).toBeNull();
    expect(declined("not_started", false)).toBeNull();
  });
});

describe("the plan", () => {
  test("is empty while the project has none", () => {
    expect(outlinePlan([])).toEqual([]);
  });

  test("a ready-made plan is one group of its steps", () => {
    const plan = outlinePlan(planning.plan);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.name).toBe("Build a web app");
    expect(plan[0]?.steps.map((step) => step.name)).toEqual([
      "Write the brief",
      "List the constraints",
      "Compare approaches",
      "Research other bakeries",
      "Write the requirements",
    ]);
  });

  test("steps outside a group are gathered into one, between the groups around them", () => {
    const plan = outlinePlan([
      planStep("brief", "done"),
      planStep("requirements", "running"),
      planGroup("site", "Build the site", [planStep("build", "not_started")]),
      planStep("publish", "not_started"),
    ]);
    expect(plan.map((group) => [group.name, group.steps.length])).toEqual([
      [wording.projectShell.plan, 2],
      ["Build the site", 1],
      [wording.projectShell.plan, 1],
    ]);
    expect(new Set(plan.map((group) => group.id)).size).toBe(3);
  });
});

describe("the files", () => {
  test("a new project has none", () => {
    expect(projectOutline(newProject).files).toEqual([]);
  });

  test("a document's row is named as its tab was, and marked while a version is unread", () => {
    const [brief, constraints] = projectOutline(planning).files;
    expect(brief).toMatchObject({
      id: "problem_brief",
      name: wording.documentTab["problem_brief"],
      state: "ready",
      newVersion: false,
      printable: true,
      removable: false,
      parts: [],
      opens: "problem_brief",
    });
    expect(constraints?.newVersion).toBe(true);
  });

  test("a document of a kind no tab names keeps its own title", () => {
    const [notes] = projectOutline({
      ...newProject,
      documents: [filed("market_notes", { title: "Market notes" })],
    }).files;
    expect(notes?.name).toBe("Market notes");
  });

  test("follow the project's flow, with the manual after the build plan and attached files last", () => {
    expect(projectOutline(building).files.map((file) => file.id)).toEqual([
      "problem_brief",
      "design",
      "build_plan",
      MANUAL_TAB,
      "approval_package",
      "material:menu.pdf",
    ]);
  });

  test("written documents print; the design, the package and attached files do not", () => {
    const printable = projectOutline(building)
      .files.filter((file) => file.printable)
      .map((file) => file.id);
    expect(printable).toEqual(["problem_brief", "build_plan"]);
  });

  test("an attached file can be removed, and only it", () => {
    const removable = projectOutline(building)
      .files.filter((file) => file.removable)
      .map((file) => file.name);
    expect(removable).toEqual(["Spring menu.pdf"]);
  });

  test("the filed design reads as its plan, with its mockup under it", () => {
    const design = projectOutline(building).files.find(
      (file) => file.id === "design",
    );
    expect(design).toMatchObject({
      name: wording.documentTab["design"],
      state: "ready",
      newVersion: true,
      opens: "design",
    });
    expect(design?.parts).toEqual([
      {
        id: MOCKUP_TAB,
        name: wording.design.mockupTab,
        state: "ready",
        newVersion: true,
      },
    ]);
  });

  test("a design being drawn has its row before it is filed, with the mockup and concepts drawn under it", () => {
    const design = projectOutline(designing).files.find(
      (file) => file.id === "design",
    );
    expect(design?.state).toBe("drawing");
    expect(design?.parts).toEqual([
      {
        id: DRAFT_TAB,
        name: wording.design.mockupTab,
        state: "drawing",
        newVersion: false,
      },
      {
        id: conceptTab("Bold"),
        name: wording.design.conceptTab(1, "Bold"),
        state: "ready",
        newVersion: false,
      },
      {
        id: conceptTab("Calm"),
        name: wording.design.conceptTab(2, "Calm"),
        state: "drawing",
        newVersion: false,
      },
    ]);
    // With no plan to read yet, the row opens the mockup being drawn.
    expect(design?.opens).toBe(DRAFT_TAB);
  });

  test("a new mockup drawn over a filed design shows on the same row, with the writing dots", () => {
    const design = projectOutline({ ...building, draft: true }).files.find(
      (file) => file.id === "design",
    );
    expect(design?.state).toBe("ready");
    expect(design?.parts.map((part) => [part.id, part.state])).toEqual([
      [DRAFT_TAB, "drawing"],
    ]);
  });

  test("concepts with no mockup drawn open the first concept", () => {
    const design = projectOutline({
      ...designing,
      draft: false,
    }).files.find((file) => file.id === "design");
    expect(design?.opens).toBe(conceptTab("Bold"));
  });

  test("a row or a part opens its tab", () => {
    const { files } = projectOutline(designing);
    expect(fileTab(files, "product_requirements")).toBe("product_requirements");
    expect(fileTab(files, "design")).toBe(DRAFT_TAB);
    expect(fileTab(files, conceptTab("Calm"))).toBe(conceptTab("Calm"));
    expect(fileTab(files, "gone")).toBeNull();
  });
});

describe("the app", () => {
  test("is not built while the project has no app to show", () => {
    expect(outlineApp({ shown: false, state: "running" })).toBe("not_built");
    expect(projectOutline(planning).app).toBe("not_built");
  });

  test("is starting until the hub says, since keeping the project open starts it", () => {
    expect(outlineApp({ shown: true, state: undefined })).toBe("starting");
  });

  test("reads as the hub says once it has", () => {
    for (const state of [
      "not_built",
      "starting",
      "running",
      "stopped",
      "failed",
    ] as const)
      expect(outlineApp({ shown: true, state })).toBe(state);
    expect(projectOutline(building).app).toBe("running");
  });
});
