import { expect } from "bun:test";
import { DESIGNER_REPORT, WEATHER_CONCEPT, WEATHER_MOCKUP } from "./concept.ts";
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
import { withLongerAppCheck } from "./specialists.ts";

const idea =
  "I want a weather app where the whole screen animates to match the live weather.";

scenario({
  name: "s14-full-route",
  title:
    "build-web-app on a fresh project: requirements approved, a design chosen, a plan approved, the app built",
  start: { fresh: idea },
  coordinator: [
    turn(
      user("weather app"),
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
      question("c_approve_requirements", "writer", "approve", {
        kinds: ["product_requirements"],
      }),
    ),
    turn(
      results(ok("c_approve_requirements", "question", '"approved"')),
      execute("c_mockup", "designer", "mockup", WEATHER_MOCKUP),
    ),
    turn(results(ok("c_mockup", "execute")), say("A designer is on it.")),
    turn(
      user(DESIGNER_REPORT),
      question("c_choose", "designer", "review", {
        note: "The weather-driven design. Approve it to build from it.",
      }),
    ),
    turn(
      results(ok("c_choose", "question", '"approved"')),
      execute("c_plan", "writer", "write-build-plan", {
        instruction: "Plan the build of the approved requirements and design.",
      }),
    ),
    turn(
      results(ok("c_plan", "execute")),
      say("A writer is planning the build."),
    ),
    turn(user(`The person chose the ${WEATHER_CONCEPT.label}`), say("Noted.")),
    turn(
      user("written the build plan"),
      question("c_approve_plan", "writer", "approve", {
        kinds: ["build_plan"],
      }),
    ),
    turn(
      results(ok("c_approve_plan", "question", '"approved"')),
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
    const approve = async (kind: string) => {
      const filed = await p.filed(kind, 1);
      await p.question();
      const answered = await p.answer({
        output: {
          approved: [{ kind, artifactId: filed.artifactId, version: 1 }],
        },
      });
      expect(answered.status).toBe(200);
    };
    await approve("product_requirements");
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
    await approve("build_plan");
    await p.filed("app", 1);
    await p.heard("Your app is built.");
    // The route's outcome holds, so the project no longer follows it.
    const route = await p.call("GET", `${p.path}/routes`);
    p.note("the routes the project follows at the end", route.body);
    const design = await p.filed("design");
    expect(design.approvedVersion).toBe(design.version);
  },
});
