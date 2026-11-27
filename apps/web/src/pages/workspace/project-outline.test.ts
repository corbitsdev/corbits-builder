import { describe, expect, test } from "bun:test";
import { LIVE_TAB } from "./tab-follow.ts";
import {
  building,
  coordinatorPlan,
  filed,
  newProject,
  planGroup,
  planning,
  planStep,
} from "./project-outline.fixtures.ts";
import {
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
    const mark = { by: "person", at: "2026-11-20T10:00:00Z" };
    const cancelled = planStep("step", "cancelled", {
      optional: true,
      cancelled: mark,
    });
    expect(outlineStep(cancelled).declined).toBeNull();
    cancelled.declined = mark;
    expect(outlineStep(cancelled).declined).toBeNull();
  });
});

describe("the plan", () => {
  test("is empty while the project has none, with no row made up", () => {
    expect(outlinePlan([])).toEqual([]);
    expect(projectOutline(newProject).plan).toEqual([]);
  });

  test("lists a plan the coordinator wrote step by step, each named and standing as saved", () => {
    const rows = projectOutline(coordinatorPlan).plan;
    expect(rows.map((row) => [row.name, row.state])).toEqual([
      ["Look at how other bakeries take orders", "done"],
      ["Compare order formats", "done"],
      ["Ask which format to read", "needs_you"],
      ["Build the order import tool", "to_do"],
      ["Try the tool on last week's orders", "to_do"],
    ]);
  });

  test("a step that makes nothing is a row of its own, opening nothing", () => {
    const [look] = projectOutline(coordinatorPlan).plan;
    expect(look).toMatchObject({ opens: null });
  });

  test("each step row carries its own settings for its menu", () => {
    const rows = projectOutline(coordinatorPlan).plan;
    expect(rows[3]!.steps).toEqual([
      {
        id: "tool",
        name: "Build the order import tool",
        state: "to_do",
        askFirst: true,
        declined: null,
      },
    ]);
    expect(rows[4]!.steps[0]!.declined).toBe(false);
  });

  test("a ready-made plan's steps are listed in order, with no row for the plan itself", () => {
    const rows = projectOutline(planning).plan;
    expect(rows.map((row) => [row.id, row.state])).toEqual([
      ["brief", "done"],
      ["constraints", "done"],
      ["approaches", "running"],
      ["research", "to_do"],
      ["requirements", "needs_you"],
    ]);
  });

  test("a group's steps and steps outside it keep the plan's order", () => {
    const rows = outlinePlan([
      planStep("first", "done"),
      planGroup("group", "A group", [planStep("inside", "running")]),
      planStep("last", "not_started"),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["first", "inside", "last"]);
  });

  test("a step opens what it made once the project has it, and not before", () => {
    const step = planStep("brief", "done", { makes: ["problem_brief"] });
    expect(outlinePlan([step])[0]!.opens).toBeNull();
    expect(outlinePlan([step], [filed("problem_brief")])[0]).toMatchObject({
      opens: "problem_brief",
    });
  });

  test("a running step carries when it started and what its run last said", () => {
    const step = planStep("approaches", "running", {
      startedAt: "2026-11-24T10:00:00Z",
      summary: "Weighing three ways to take orders",
    });
    expect(outlinePlan([step])[0]).toMatchObject({
      startedAt: "2026-11-24T10:00:00Z",
      summary: "Weighing three ways to take orders",
    });
    expect(outlinePlan([planStep("next", "not_started")])[0]).toMatchObject({
      startedAt: null,
      summary: null,
    });
  });

  test("of several things a step makes, it opens the first the project has", () => {
    const step = planStep("write", "done", { makes: ["plan", "notes"] });
    expect(outlinePlan([step], [filed("notes")])[0]!.opens).toBe("notes");
  });

  test("the step that makes the app opens it once it can be shown", () => {
    const step = planStep("build", "running", { makes: ["app"] });
    expect(outlinePlan([step])[0]!.opens).toBeNull();
    expect(outlinePlan([step], [], true)[0]!.opens).toBe(LIVE_TAB);
  });

  test("each step opens what it made among the project view.s documents", () => {
    const rows = projectOutline(building).plan;
    expect(rows.map((row) => row.opens)).toEqual([
      "problem_brief",
      "design",
      LIVE_TAB,
      null,
    ]);
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
