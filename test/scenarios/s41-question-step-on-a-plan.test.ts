import { expect } from "bun:test";
import { type } from "arktype";
import { WEATHER_CONCEPT, WEATHER_MOCKUP } from "./concept.ts";
import { designerFor } from "./specialists.ts";
import {
  call,
  execute,
  ok,
  results,
  say,
  scenario,
  turn,
  user,
  type Person,
} from "./runner.ts";

const LOOKS = "Choose how many looks";
const paper = {
  label: "Calm paper",
  direction:
    "Quiet off-white paper, one serif for headings, thin rules and no animation behind the text.",
};

const PlanRead = type({
  steps: type({
    title: "string",
    "steps?": type({ title: "string", state: "string" }).array(),
  }).array(),
});

// The state of the ready-made plan's step with the title, as the project's plan shows it.
async function stepState(p: Person, title: string) {
  const read = await p.call("GET", `${p.path}/plan`);
  expect(read.status).toBe(200);
  const [group] = PlanRead.assert(read.body).steps;
  const step = group?.steps?.find((each) => each.title === title);
  if (!step) throw new Error(`The plan has no step "${title}"`);
  return step.state;
}

const takeUpPlan = turn(
  user("Design it"),
  call("c_follow", "plan", { operation: "add", plan: "build-web-app" }),
);

scenario({
  name: "s41-question-step-on-a-plan",
  title:
    "the build-web-app plan's question step: the coordinator executes Choose how many looks, the person answers Two, the step shows as done on the plan, and the mockup then makes two concepts",
  start: "weather-documents",
  coordinator: [
    takeUpPlan,
    turn(
      results(ok("c_follow", "plan", LOOKS)),
      execute("c_looks", "designer", "looks", { current: "one" }),
    ),
    turn(
      results(ok("c_looks", "execute", '"two"')),
      execute("c_mockup", "designer", "mockup", {
        instruction: WEATHER_MOCKUP.instruction,
        lookIdeas: WEATHER_MOCKUP.lookIdeas,
        concepts: [WEATHER_CONCEPT, paper],
      }),
    ),
    turn(results(ok("c_mockup", "execute")), say("Two designers are on it.")),
    turn(user(), say("One concept is in.")),
    turn(user(), say("Both concepts are in.")),
  ],
  specialists: {
    "designer-1": {
      role: "designer",
      turns: designerFor(WEATHER_CONCEPT.label),
    },
    "designer-2": { role: "designer", turns: designerFor(paper.label) },
  },
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.say("Design it, and let me choose how many looks to compare.");
    const asked = await p.question();
    p.note("the looks screen", asked.asked);
    const answered = await p.answer({ output: { looks: "two" } });
    expect(answered.status).toBe(200);
    await p.heard("Two designers are on it.");
    p.note("looks returned", p.resultOf("c_looks").text);
    expect(await stepState(p, LOOKS)).toBe("done");
    await p.filed("design_option");
    await p.heard("Both concepts are in.");
    const { artifacts } = await p.hub.client.projectArtifacts(
      p.tenantId,
      p.projectId,
    );
    const options = artifacts.filter(({ kind }) => kind === "design_option");
    p.note("the design options filed", options);
    expect(options).toHaveLength(2);
  },
});

scenario({
  name: "s41-question-step-handed-over",
  title:
    "with approvals handed over, the build-web-app plan's Choose how many looks step is skipped",
  start: "weather-documents",
  coordinator: [
    takeUpPlan,
    turn(results(ok("c_follow", "plan", LOOKS)), say("Planned.")),
  ],
  person: async (p) => {
    await p.heard("The project is imported.");
    await p.prefer({ agent_decides_approvals: "yes" });
    await p.say("Design it; I leave the approvals to you.");
    await p.heard("Planned.");
    expect(await stepState(p, LOOKS)).toBe("skipped");
  },
});
