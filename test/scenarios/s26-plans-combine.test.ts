import { expect } from "bun:test";
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
} from "./runner.ts";

const plan = {
  instruction:
    "Plan the build of the animated weather app from the approved requirements.",
};

scenario({
  name: "s26-plans-combine",
  title:
    "build-web-app advises on a build plan started before the design is chosen, and after leaving the build-web-app plan the same call carries no advice",
  start: "weather-documents",
  coordinator: [
    turn(
      user("Plan the build"),
      call("c_follow", "plan", { operation: "add", plan: "build-web-app" }),
    ),
    turn(
      results(ok("c_follow", "plan")),
      execute("c_plan_held", "writer", "write-build-plan", plan),
    ),
    turn(
      results(refused("c_plan_held", "execute")),
      say("The plan waits for you to choose a design first."),
    ),
    turn(
      user("I leave the approvals"),
      execute("c_plan_advised", "writer", "write-build-plan", plan),
    ),
    turn(
      results(ok("c_plan_advised", "execute", '"advice"')),
      say("A writer is planning; the plan suggested a design first."),
    ),
    turn(user(), call("c_leave", "plan", { operation: "set", steps: [] })),
    turn(
      results(ok("c_leave", "plan")),
      execute("c_plan_plain", "writer", "write-build-plan", plan),
    ),
    turn(
      results(ok("c_plan_plain", "execute")),
      say("Another writer is planning."),
    ),
    turn(user(), say("The plan is revised.")),
  ],
  specialists: {
    "plan-1": { role: "writer", turns: await recorded("writer-5") },
    "plan-2": { role: "writer", turns: await recorded("writer-5") },
  },
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.say("Plan the build, following the usual plan.");
    await p.heard("The plan waits for you to choose a design first.");
    await p.prefer({ agent_decides_approvals: "yes" });
    await p.say("I leave the approvals to you; plan it anyway.");
    await p.heard("The plan is revised.");
    for (const id of [
      "c_follow",
      "c_plan_held",
      "c_plan_advised",
      "c_leave",
      "c_plan_plain",
    ])
      p.note(`${id} returned`, p.resultOf(id).text);
    expect(p.resultOf("c_plan_plain").text).not.toContain('"advice"');
    await p.filed("build_plan", 2);
  },
});
