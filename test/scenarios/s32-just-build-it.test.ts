import { expect } from "bun:test";
import { DESIGNER_REPORT, WEATHER_MOCKUP } from "./concept.ts";
import {
  call,
  execute,
  ok,
  recorded,
  refused,
  results,
  say,
  scenario,
  turn,
  user,
  withLongerAppCheck,
} from "./runner.ts";

const idea =
  "I want a weather app where the whole screen animates to match the live weather. Just build it.";
const EXECUTES = ["c_requirements", "c_mockup", "c_plan", "c_build"];

scenario({
  name: "s32-just-build-it",
  title:
    "just build it: coder build is refused without documents, the person hands approvals over on one screen, Builder chooses the one design, and the plan runs to a built app with no approval asked",
  start: { fresh: idea },
  coordinator: [
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
      execute("c_requirements", "writer", "write-requirements", {
        instruction:
          "An animated weather web app: current conditions, 24-hour and 7-day forecasts, saved cities and a compare view, using Open-Meteo.",
      }),
    ),
    turn(results(ok("c_requirements", "execute")), say("A writer is on it.")),
    turn(
      user("written the requirements"),
      execute("c_mockup", "designer", "mockup", WEATHER_MOCKUP),
    ),
    turn(results(ok("c_mockup", "execute")), say("A designer is on it.")),
    turn(
      user(DESIGNER_REPORT),
      execute("c_plan", "writer", "write-build-plan", {
        instruction: "Plan the build of the requirements and the design.",
      }),
    ),
    turn(results(ok("c_plan", "execute")), say("A writer is on the plan.")),
    // The plan's report.
    turn(
      user(),
      execute("c_build", "coder", "build", {
        starter: "web-app",
        instruction: "Build the whole app from the plan and the design.",
      }),
    ),
    turn(results(ok("c_build", "execute")), say("A coder is building it.")),
    turn(user("Animated Weather"), say("Your app is built.")),
  ],
  specialists: {
    requirements: { role: "writer", turns: await recorded("writer-4") },
    designer: { role: "designer", turns: await recorded("designer-1") },
    plan: { role: "writer", turns: await recorded("writer-5") },
    coder: {
      role: "coder",
      turns: withLongerAppCheck(await recorded("coder-1")),
    },
  },
  person: async (p) => {
    const handOver = await p.question();
    p.note("the hand-over screen", handOver.asked);
    const early = p.resultOf("c_build_early");
    p.note("coder build before the hand-over returned", early.text);
    expect(early.isError).toBe(true);
    expect(early.text).toContain("build plan");
    const handed = await p.answer({ output: { decides: "builder" } });
    expect(handed.status).toBe(200);
    await p.filed("product_requirements", 1);
    // The one concept's option is the design as it is filed, with no question to the person.
    expect(WEATHER_MOCKUP.concepts).toHaveLength(1);
    await p.filed("design", 1);
    await p.filed("build_plan", 1);
    await p.filed("app", 1);
    await p.heard("Your app is built.");
    for (const id of EXECUTES) p.note(`${id} returned`, p.resultOf(id).text);
    p.note("every message the coordinator received", p.messages("coordinator"));
    // Handing over left the approvals to Builder, so the design started on requirements nobody
    // approved, Builder chose the one design, and the plan and the build start with no advice.
    for (const id of EXECUTES)
      expect(p.resultOf(id).text).not.toContain('"advice"');
    const report = p
      .messages("coordinator")
      .find((message) => message.includes(DESIGNER_REPORT));
    expect(report).toContain("chosen automatically");
    expect(report).not.toContain('action: "choose"');
    expect(report).not.toContain('action: "review"');
  },
});
