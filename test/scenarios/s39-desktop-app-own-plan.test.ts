import { expect } from "bun:test";
import { type } from "arktype";
import {
  call,
  execute,
  ok,
  results,
  say,
  scenario,
  turn,
  user,
} from "./runner.ts";

const idea = "I want a desktop app that keeps my grocery list.";
const lookUp =
  "Find out how a small desktop app is best built today, the stack and how its window is checked while building, for a grocery list app.";
const found =
  "A desktop app is best built with Electron or Tauri on TypeScript; its window cannot be opened while building, so its checks are a typecheck, the tests and a build.";
const requirements =
  "A desktop grocery list app: add, tick off and remove items, kept between launches.";

const PlanRead = type({
  steps: type({
    title: "string",
    "plugin?": "string",
    "action?": "string",
    "input?": "Record<string, unknown>",
  }).array(),
});

scenario({
  name: "s39-desktop-app-own-plan",
  title:
    "a desktop app has no fitting ready-made plan: discover offers the web app plan first, the coordinator does not take it, the worker looks up how to build it, and the coordinator sets its own plan of requirements, a build plan and a build with no starter",
  start: { fresh: idea },
  coordinator: [
    turn(
      user("desktop app"),
      call("c_discover", "discover", { query: "build a desktop app" }),
    ),
    turn(
      results(ok("c_discover", "discover", "build-web-app")),
      execute("c_look_up", "worker", "do", { instruction: lookUp }),
    ),
    turn(
      results(ok("c_look_up", "execute", '"started":true')),
      say("A worker is looking it up."),
    ),
    turn(
      user(found),
      call("c_plan", "plan", {
        operation: "set",
        steps: [
          {
            title: "Write the requirements",
            plugin: "writer",
            action: "write-requirements",
            input: { instruction: requirements },
          },
          {
            title: "Write the build plan",
            plugin: "writer",
            action: "write-build-plan",
            input: {
              instruction:
                "Plan the build of the approved requirements as a desktop app on TypeScript.",
            },
          },
          {
            title: "Build the app",
            plugin: "coder",
            action: "build",
            input: {
              instruction:
                "Build the desktop grocery list app from the approved requirements and build plan.",
            },
          },
        ],
      }),
    ),
    turn(results(ok("c_plan", "plan", "Build the app")), say("Planned.")),
  ],
  specialists: {
    worker: {
      role: "writer",
      turns: [turn(user("desktop app is best built"), say(found))],
    },
  },
  person: async (p) => {
    await p.heard("Planned.");
    const discovered = p.resultOf("c_discover").text;
    p.note("discover for a desktop app", discovered);
    expect(discovered).toStartWith("build-web-app (ready-made plan)");
    p.note("worker do returned", p.resultOf("c_look_up").text);
    // The regression: starting the worker failed with "specialist run not found".
    expect(p.resultOf("c_look_up").isError).toBe(false);
    expect(p.asked("worker")).toBe(1);
    expect(p.messages("coordinator").some((said) => said.includes(found))).toBe(
      true,
    );

    const read = await p.call("GET", `${p.path}/plan`);
    expect(read.status).toBe(200);
    const { steps } = PlanRead.assert(read.body);
    p.note("the coordinator's own plan", steps);
    expect(steps.map(({ plugin, action }) => `${plugin} ${action}`)).toEqual([
      "writer write-requirements",
      "writer write-build-plan",
      "coder build",
    ]);
    expect(steps[2]?.input).not.toHaveProperty("starter");
    const following = await p.call("GET", `${p.path}/following`);
    p.note("the plans the project follows", following.body);
    expect(JSON.stringify(following.body)).not.toContain("build-web-app");
  },
});
