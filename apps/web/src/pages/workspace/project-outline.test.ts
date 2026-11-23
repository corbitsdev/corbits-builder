import { describe, expect, test } from "bun:test";
import { wording } from "../../config.ts";
import { conceptTab } from "./design-concept.ts";
import { DRAFT_TAB, LIVE_TAB, MANUAL_TAB, MOCKUP_TAB } from "./tab-follow.ts";
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
  const webApp = (steps: Parameters<typeof planGroup>[2], name?: string) =>
    planGroup("web-app", "A ready-made plan for a web app", steps, {
      plan: "web-app",
      ...(name === undefined ? {} : { name }),
    });

  test("is empty while the project has none", () => {
    expect(outlinePlan([])).toEqual([]);
  });

  test("is a row for each thing made, named as its tab is, holding the steps before it that make nothing", () => {
    const rows = outlinePlan([
      webApp([
        planStep("requirements", "done", {
          makes: ["product_requirements"],
        }),
        planStep("looks", "done", { optional: true }),
        planStep("mockup", "running", {
          title: "Design the look",
          makes: ["design_option"],
        }),
        planStep("build", "not_started", { makes: ["app"] }),
      ]),
    ]);
    expect(rows.map((row) => row.name)).toEqual([
      wording.documentTab["product_requirements"]!,
      wording.projectShell.makes["design_option"]!,
      wording.projectShell.makes["app"]!,
    ]);
    expect(rows.map((row) => row.steps.length)).toEqual([1, 2, 1]);
    expect(rows.map((row) => row.app)).toEqual([false, false, true]);
  });

  test("steps after the last thing made are one row named for what their plan makes", () => {
    const rows = outlinePlan([
      webApp(
        [
          planStep("ready", "done"),
          planStep("where", "needs_you", {
            title: "Confirm where your app goes",
          }),
          planStep("live", "not_started"),
        ],
        "Published on Cloudflare",
      ),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "Published on Cloudflare",
      state: "needs_you",
      doing: "Confirm where your app goes",
    });
  });

  test("steps after the last thing made join its row when their plan names nothing", () => {
    const rows = outlinePlan([
      webApp([
        planStep("manual", "done", { makes: ["user_manual"] }),
        planStep("review", "running", { title: "Review the manual" }),
      ]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: wording.documentTab["user_manual"],
      state: "running",
      doing: "Review the manual",
    });
  });

  test("a step outside a group is a row of its own, named for it when it makes nothing", () => {
    const rows = outlinePlan([
      planStep("brief", "done", { makes: ["problem_brief"] }),
      planStep("call", "not_started", { title: "Call the bakery" }),
    ]);
    expect(rows.map((row) => row.name)).toEqual([
      wording.documentTab["problem_brief"]!,
      "Call the bakery",
    ]);
  });

  test("reads as its steps stand: what waits on the person first, then a failure, then work", () => {
    const state = (...states: Parameters<typeof planStep>[1][]) =>
      outlinePlan([
        webApp(
          states.map((each, index) => planStep(`s${String(index)}`, each)),
          "Published",
        ),
      ])[0]?.state;
    expect(state("done", "needs_you", "failed")).toBe("needs_you");
    expect(state("failed", "running")).toBe("failed");
    expect(state("done", "running")).toBe("running");
    expect(state("done", "done")).toBe("done");
    expect(state("done", "not_started")).toBe("to_do");
    expect(state("skipped", "cancelled")).toBe("declined");
  });

  test("says nothing under its name while the step that makes it is the one at work", () => {
    const [row] = outlinePlan([
      planStep("build", "running", { makes: ["app"] }),
    ]);
    expect(row?.doing).toBeNull();
  });

  test("opens the first thing it made that the project has, and the app once it is shown", () => {
    const { files } = projectOutline(designing);
    const opens = (makes: string[], appShown = false) =>
      outlinePlan([planStep("step", "done", { makes })], files, appShown)[0]
        ?.opens;
    expect(opens(["gone", "product_requirements"])).toBe(
      "product_requirements",
    );
    expect(opens(["design_option"])).toBe(DRAFT_TAB);
    expect(opens(["build_plan"])).toBeNull();
    expect(opens(["app"])).toBeNull();
    expect(opens(["app"], true)).toBe(LIVE_TAB);
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

  test("an unfiled design whose concepts are all drawn waits on a pick, with no writing dots", () => {
    const design = projectOutline({
      ...designing,
      draft: false,
      concepts: [
        { label: "Bold", drawn: true },
        { label: "Calm", drawn: true },
      ],
    }).files.find((file) => file.id === "design");
    expect(design?.state).toBe("ready");
    expect(design?.opens).toBe(conceptTab("Bold"));
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
