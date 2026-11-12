import { expect } from "bun:test";
import { DESIGNER_REPORT, WEATHER_MOCKUP } from "./concept.ts";
import { withLongerAppCheck } from "./specialists.ts";
import {
  execute,
  ok,
  question,
  recorded,
  results,
  say,
  scenario,
  turn,
  user,
} from "./runner.ts";

const idea =
  "I want a weather app where the whole screen animates to match the live weather.";
const EXECUTES = ["c_requirements", "c_mockup", "c_plan", "c_build"];

scenario({
  name: "s22-approvals-left-to-builder",
  title:
    "build-web-app with approvals left to Builder: requirements to a built app with no approval asked",
  start: { fresh: idea },
  coordinator: [
    turn(user("weather app"), say("How would you like to work?")),
    turn(
      user("approvals to you"),
      execute("c_route", "build-web-app", undefined, {}),
    ),
    turn(
      results(ok("c_route", "execute", "write-requirements")),
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
    // The plan starts while the person still chooses the design.
    turn(
      user(DESIGNER_REPORT),
      execute("c_plan", "writer", "write-build-plan", {
        instruction: "Plan the build of the requirements and the design.",
      }),
    ),
    turn(
      results(ok("c_plan", "execute")),
      question("c_choose", "designer", "review", {
        note: "The weather-driven design. Approve it to build from it.",
      }),
    ),
    turn(
      results(ok("c_choose", "question", '"approved"')),
      say("You chose the design."),
    ),
    // The plan's report and the note of the person's choice, in either order.
    turn(user(), say("Noted.")),
    turn(
      user(),
      execute("c_build", "coder", "build", {
        instruction: "Build the whole app from the plan and the chosen design.",
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
    await p.heard("How would you like to work?");
    await p.prefer({ agent_decides_approvals: "yes" });
    await p.say("Build it. I leave the approvals to you.");
    const option = await p.filed("design_option", 1);
    await p.question();
    const chosen = await p.answer({
      output: {
        decision: "approved",
        option: option.artifactId,
        version: option.version,
        comments: [],
      },
    });
    expect(chosen.status).toBe(200);
    await p.filed("app", 1);
    await p.heard("Your app is built.");
    p.note("following the route returned", p.resultOf("c_route").text);
    for (const id of EXECUTES) p.note(`${id} returned`, p.resultOf(id).text);
    p.note("every message the coordinator received", p.messages("coordinator"));
    for (const id of ["c_requirements", "c_mockup", "c_build"])
      expect(p.resultOf(id).text).not.toContain('"advice"');
    expect(p.resultOf("c_plan").text).toContain('"advice"');
  },
});
