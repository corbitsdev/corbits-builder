import { expect, test } from "bun:test";
import {
  call,
  execute,
  ok,
  openProject,
  recorded,
  refused,
  results,
  say,
  TOOL_RECORDINGS,
  turn,
  user,
  withLongerCheck,
  type Run,
  type ScriptedProject,
  type Turn,
} from "../support/scripted-project.ts";

// Read when the hub builds its agent packages and when it spawns a check's command host.
process.env["BUILDER_TOOL_REPLAY"] = TOOL_RECORDINGS;

const IDEA =
  "I want a weather app where the whole screen animates to match the live weather.";
const REQUIREMENTS = {
  instruction:
    "An animated weather web app: current conditions, 24-hour and 7-day forecasts, saved cities and a compare view, using Open-Meteo.",
};
// The concept the recorded designer was given, which its turns expect.
const CONCEPT = {
  label: "Adaptive weather-driven",
  direction:
    "Modern and sleek base: crisp neutrals, system sans-serif, generous whitespace, subtle depth, with frosted soft panels over the scene. The accent and background palette shift per weather condition and day/night (e.g. warm amber for hot, slate blue for rain, deep indigo for night). Flexible layout that reflows between phone and desktop.",
};
const MOCKUP = {
  instruction:
    "Design one adaptive, weather-driven UI for the Animated Weather App: full-screen animated weather scenes with palettes that shift with the weather, current conditions, 24-hour and 7-day forecasts, city search, saved cities, a compare view and settings, on phone and desktop.",
  lookIdeas:
    "Dynamic and flexible look that adapts its palette and full-screen weather animations to the current condition and time of day, with frosted readable panels.",
  concepts: [CONCEPT],
  createTheme: true,
};
const DESIGNER_REPORT = "The weather-driven design is filed";

// The coordinator's turns with the recorded weather project's specialists, by the run keys the
// turns use.
const weatherRuns = async (
  coordinator: readonly Turn[],
): Promise<Record<string, Run>> => ({
  coordinator: { role: "coordinator", turns: coordinator },
  requirements: { role: "writer", turns: await recorded("writer-4") },
  designer: { role: "designer", turns: await recorded("designer-1") },
  plan: { role: "writer", turns: await recorded("writer-5") },
  coder: { role: "coder", turns: withLongerCheck(await recorded("coder-1")) },
});

const approvedRequirements = results(
  ok("c_approve_requirements", "execute", '"approved"'),
);

const LONG_WAY: readonly Turn[] = [
  turn(
    user("weather app"),
    call("c_follow", "plan", { operation: "add", plan: "build-web-app" }),
  ),
  turn(
    results(ok("c_follow", "plan", "write-requirements")),
    execute("c_requirements", "writer", "write-requirements", REQUIREMENTS),
  ),
  turn(results(ok("c_requirements", "execute")), say("A writer is on it.")),
  turn(
    user("written the requirements"),
    execute("c_approve_requirements", "writer", "approve", {
      kinds: ["product_requirements"],
    }),
  ),
  turn(approvedRequirements, execute("c_mockup", "designer", "mockup", MOCKUP)),
  turn(results(ok("c_mockup", "execute")), say("A designer is on it.")),
  turn(
    user(DESIGNER_REPORT),
    execute("c_choose", "designer", "review", {
      note: "The weather-driven design. Approve it to build from it.",
    }),
  ),
  turn(
    results(ok("c_choose", "execute", '"approved"')),
    execute("c_plan", "writer", "write-build-plan", {
      instruction: "Plan the build of the approved requirements and design.",
    }),
  ),
  turn(
    results(ok("c_plan", "execute")),
    say("A writer is planning the build."),
  ),
  turn(user(`The person chose the ${CONCEPT.label}`), say("Noted.")),
  turn(
    user("written the build plan"),
    execute("c_approve_plan", "writer", "approve", { kinds: ["build_plan"] }),
  ),
  turn(
    results(ok("c_approve_plan", "execute", '"approved"')),
    execute("c_build", "coder", "build", {
      starter: "web-app",
      instruction: "Build the whole app from the plan and the chosen design.",
    }),
  ),
  turn(results(ok("c_build", "execute")), say("A coder is building it.")),
  turn(user("Animated Weather"), say("Your app is built.")),
];

/** The person approves the first version of the document of the kind once it is put to them. */
async function approveFirst(project: ScriptedProject, kind: string) {
  const filed = await project.filed(kind, 1);
  const open = await project.question();
  const answered = await project.answer(open.signalName, {
    output: { approved: [{ kind, artifactId: filed.artifactId, version: 1 }] },
  });
  expect(answered.status).toBe(200);
}

test("a new web app the long way: requirements approved, a design chosen, a build plan approved, the app built, and the plan finished", async () => {
  const project = await openProject({
    start: { idea: IDEA, title: "Animated Weather App" },
    runs: await weatherRuns(LONG_WAY),
  });
  try {
    await approveFirst(project, "product_requirements");
    const option = await project.filed("design_option", 1);
    const review = await project.question();
    const chosen = await project.answer(review.signalName, {
      output: {
        decision: "approved",
        option: option.artifactId,
        version: option.version,
        comments: [],
      },
    });
    expect(chosen.status).toBe(200);
    await approveFirst(project, "build_plan");
    await project.filed("app", 1);
    await project.heard("Your app is built.");

    const design = await project.filed("design");
    expect(design.approvedVersion).toBe(design.version);
    const following = await project.call("GET", `${project.path}/following`);
    expect(following.body).toEqual({ following: [] });
    expect(await project.actionsRun()).toEqual([
      "writer write-requirements",
      "designer mockup",
      "writer write-build-plan",
      "coder build",
    ]);
    await project.finish();
  } finally {
    await project.close();
  }
}, 900_000);

const executes = ["c_requirements", "c_mockup", "c_plan", "c_build"];

test("just build it: a build before any document is refused, the person hands approvals over once, and the plan runs to a built app with no further approval asked", async () => {
  const project = await openProject({
    start: { idea: `${IDEA} Just build it.`, title: "Animated Weather App" },
    runs: await weatherRuns([
      turn(
        user("Just build it"),
        execute("c_build_early", "coder", "build", {
          starter: "web-app",
          instruction:
            "Build an animated weather web app: current conditions and forecasts, the whole screen animating to the live weather.",
        }),
      ),
      turn(
        results(refused("c_build_early", "execute", "product requirements")),
        execute("c_hand_over", "project", "hand-over", { decides: "person" }),
      ),
      turn(
        results(ok("c_hand_over", "execute", '"builder"')),
        call("c_follow", "plan", { operation: "add", plan: "build-web-app" }),
      ),
      turn(
        results(ok("c_follow", "plan", "write-requirements")),
        execute("c_requirements", "writer", "write-requirements", REQUIREMENTS),
      ),
      turn(results(ok("c_requirements", "execute")), say("A writer is on it.")),
      turn(
        user("written the requirements"),
        execute("c_mockup", "designer", "mockup", MOCKUP),
      ),
      turn(results(ok("c_mockup", "execute")), say("A designer is on it.")),
      turn(
        user(DESIGNER_REPORT),
        execute("c_plan", "writer", "write-build-plan", {
          instruction: "Plan the build of the requirements and the design.",
        }),
      ),
      turn(results(ok("c_plan", "execute")), say("A writer is on the plan.")),
      turn(
        user("written the build plan"),
        execute("c_build", "coder", "build", {
          starter: "web-app",
          instruction: "Build the whole app from the plan and the design.",
        }),
      ),
      turn(results(ok("c_build", "execute")), say("A coder is building it.")),
      turn(user("Animated Weather"), say("Your app is built.")),
    ]),
  });
  try {
    const handOver = await project.question();
    expect(handOver.asked).toMatchObject({
      plugin: "project",
      action: "hand-over",
    });
    const handed = await project.answer(handOver.signalName, {
      output: { decides: "builder" },
    });
    expect(handed.status).toBe(200);
    // One wait per run: the four runs together can outlast a single wait.
    for (const kind of ["product_requirements", "design_option", "build_plan"])
      await project.filed(kind, 1);
    await project.filed("app", 1);
    await project.heard("Your app is built.");

    // Only the hand-over was ever put to the person.
    expect(await project.questions()).toMatchObject([
      { signalName: handOver.signalName, status: "answered" },
    ]);
    expect((await project.filed("design", 1)).approvedVersion).toBe(1);
    for (const id of executes) {
      const started = project.resultOf(id);
      expect(started.isError).toBe(false);
      expect(started.text).not.toContain('"advice"');
    }
    await project.finish();
  } finally {
    await project.close();
  }
}, 900_000);
