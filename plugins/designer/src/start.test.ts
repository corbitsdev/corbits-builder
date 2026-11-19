import { describe, expect, test } from "bun:test";
import type { Concept, Filed, StarterProject } from "@corbits-builder/plugin";
import starter from "./start.ts";

const unused = () => {
  throw new Error("the designer's start does not call this");
};

const filed: Filed = {
  versions: new Map(),
  approved: () => undefined,
  document: unused,
  design: unused,
  startHere: () => undefined,
};

// A project with these facts and saved values, which records each designer's assignment.
function projectWith(
  facts: readonly string[],
  values: Readonly<Record<string, unknown>> = {},
) {
  const assignments = new Map<string, string>();
  const project: StarterProject = {
    appStarters: new Map(),
    heldBack: unused,
    state: async () => ({
      facts: new Set(facts),
      personFacts: new Set(),
      asksApprovals: true,
      checks: [],
      preferences: {},
    }),
    values: async (names) =>
      Object.fromEntries(names.map((name) => [name, values[name] ?? null])),
    working: async () => [],
    startConcepts: async ({ concepts, assignment }) =>
      concepts.map((concept: Concept, index) => {
        assignments.set(concept.label, assignment(filed, concept));
        return { concept: concept.label, runId: `run-${index}` };
      }),
    startAlone: unused,
    deploy: unused,
  };
  return { project, assignments };
}

const LOOK = {
  label: "Workbench",
  direction: "Café owners work through takings and bills in tables.",
};
const OWN = {
  label: "Quiet ledger",
  direction: "Warm paper, ink-black text and one muted green.",
};
const task = {
  instruction:
    "Design the screens of a bookkeeping app for small cafés: the day's takings and the supplier bills.",
  lookIdeas: "They left the look to us.",
};

const start = (input: Record<string, unknown>, project: StarterProject) =>
  starter.run({ workflow: "designer" }, input, project, "");

const refusal = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error.message;
  }
  throw new Error("the designer started");
};

describe("a theme by its label", () => {
  test("gives the designer the whole theme it names", async () => {
    const { project, assignments } = projectWith([
      "filed:product_requirements",
    ]);
    await start({ ...task, concepts: [LOOK] }, project);
    expect(assignments.get(LOOK.label)).toContain(
      "Its look is the Workbench theme",
    );
    expect(assignments.get(LOOK.label)).toContain("## Layout");
  });

  test("a label that is none of the looks is told to create its theme", async () => {
    const { project, assignments } = projectWith([
      "filed:product_requirements",
    ]);
    await start({ ...task, concepts: [OWN], createTheme: true }, project);
    expect(assignments.get(OWN.label)).toContain(
      "No theme is ready for this look",
    );
    expect(assignments.get(OWN.label)).toContain("Create a theme skill");
  });
});

describe("the start gate", () => {
  test("refuses a concept with no theme to start from", async () => {
    const { project } = projectWith(["filed:product_requirements"]);
    const text = await refusal(start({ ...task, concepts: [OWN] }, project));
    expect(text).toContain(`No theme for ${OWN.label}`);
    expect(text).toContain("createTheme: true");
    expect(text).not.toContain("Nothing tells the designer");
  });

  test("refuses with no guidance on what to design", async () => {
    const { project } = projectWith([]);
    const text = await refusal(start({ ...task, concepts: [LOOK] }, project));
    expect(text).toContain("Nothing tells the designer what to design");
    expect(text).toContain("audience");
    expect(text).not.toContain("No theme for");
  });

  test("names both when both are missing", async () => {
    const { project } = projectWith([]);
    const text = await refusal(start({ ...task, concepts: [OWN] }, project));
    expect(text).toContain("Nothing tells the designer what to design");
    expect(text).toContain(`No theme for ${OWN.label}`);
  });

  const themes: [string, Record<string, unknown>, string[]][] = [
    ["a theme", { concepts: [LOOK] }, []],
    ["the person's brand saved", { concepts: [OWN] }, ["look.color-primary"]],
    ["a request to create one", { concepts: [OWN], createTheme: true }, []],
  ];
  for (const [source, input, saved] of themes)
    test(`starts with a theme from ${source}`, async () => {
      const values = Object.fromEntries(saved.map((name) => [name, "#1f6f4a"]));
      const { project, assignments } = projectWith(
        ["filed:product_requirements"],
        values,
      );
      await start({ ...task, ...input }, project);
      expect(assignments.size).toBe(1);
    });

  const guidance: [string, string[], Record<string, unknown>][] = [
    ["filed requirements", ["filed:product_requirements"], {}],
    ["an app", ["app_exists"], {}],
    [
      "an audience and screens",
      [],
      {
        audience: "Café owners closing the day's books.",
        screens: ["Today: the day's takings", "Bills: what is owed to whom"],
      },
    ],
  ];
  for (const [source, facts, input] of guidance)
    test(`starts with guidance from ${source}`, async () => {
      const { project, assignments } = projectWith(facts);
      await start({ ...task, concepts: [LOOK], ...input }, project);
      expect(assignments.size).toBe(1);
    });

  test("an audience alone, without screens, is not guidance", async () => {
    const { project } = projectWith([]);
    const text = await refusal(
      start({ ...task, concepts: [LOOK], audience: "Café owners." }, project),
    );
    expect(text).toContain("Nothing tells the designer what to design");
  });
});
