import { expect } from "bun:test";
import { type } from "arktype";
import { eq } from "drizzle-orm";
import { createEnvKeyCredentialCipher } from "@intx/crypto";
import { createRunTokenStore } from "@intx/db";
import { workflowRun } from "@intx/db/schema";
import { hexDecode } from "@intx/types";
import { CREDENTIAL_KEY } from "../e2e/support/hub.ts";
import { NonEmptyString } from "../e2e/support/pipeline-driver.ts";
import { DESIGNER_REPORT, WEATHER_MOCKUP } from "./concept.ts";
import {
  call,
  execute,
  ok,
  question,
  recorded,
  refused,
  results,
  say,
  scenario,
  turn,
  user,
  type Person,
} from "./runner.ts";

const idea =
  "I want a weather app where the whole screen animates to match the live weather.";
const manual = {
  kind: "user_manual",
  title: "User manual",
  instruction:
    "Write a user manual for the app as built: what it is for, how to get started, each screen and task step by step in plain words, and answers to the questions a first-time user is likely to ask.",
};

const PlanRead = type({
  steps: type({
    title: "string",
    "steps?": type({
      id: "string",
      title: "string",
      state: "string",
      "summary?": "string",
      "optional?": "boolean",
      "approval?": "string",
    }).array(),
  }).array(),
});

// The build-web-app journey's steps as the plan shows them.
async function journey(p: Person) {
  const read = await p.call("GET", `${p.path}/plan`);
  expect(read.status).toBe(200);
  const [parent] = PlanRead.assert(read.body).steps;
  return parent?.steps ?? [];
}

// The coordinator's own run token, as its tools would send it.
async function coordinatorBearer(p: Person) {
  const [run] = await p.hub.db
    .select({ principalId: workflowRun.principalId })
    .from(workflowRun)
    .where(eq(workflowRun.id, p.coordinatorRunId));
  const tokens = createRunTokenStore({
    db: p.hub.db,
    cipher: createEnvKeyCredentialCipher(hexDecode(CREDENTIAL_KEY)),
  });
  const [delivery] = await tokens.loadDelivery(
    NonEmptyString.assert(run?.principalId),
  );
  if (delivery === undefined)
    throw new Error("The coordinator run holds no run token");
  return {
    authorization: `Bearer ${delivery.token}`,
    "content-type": "application/json",
  };
}

scenario({
  name: "s34-journey-flags",
  title:
    "the build-web-app journey goes on the plan with its user manual optional; the person declines the manual, which the coordinator's token cannot and execute then refuses; a required step cannot be declined; after a hand-over the design starts without asking",
  start: { fresh: idea },
  coordinator: [
    turn(
      user("weather app"),
      call("c_plan", "plan", { operation: "add", route: "build-web-app" }),
    ),
    turn(results(ok("c_plan", "plan", '"optional":true')), say("Planned.")),
    turn(
      user("declined the plan step"),
      execute("c_manual", "writer", "write", manual),
    ),
    turn(
      results(refused("c_manual", "execute", "the person declined this step")),
      question("c_hand_over", "project", "hand-over", { decides: "person" }),
    ),
    turn(
      results(ok("c_hand_over", "question", '"builder"')),
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
    turn(
      results(ok("c_mockup", "execute", '"started":true')),
      say("A designer is on it."),
    ),
    turn(user(DESIGNER_REPORT), say("The design is chosen.")),
  ],
  specialists: {
    requirements: { role: "writer", turns: await recorded("writer-4") },
    designer: { role: "designer", turns: await recorded("designer-1") },
  },
  person: async (p) => {
    await p.heard("Planned.");
    p.note("plan add { route } returned", p.resultOf("c_plan").text);
    const steps = await journey(p);
    p.note("the journey's steps on the plan", steps);
    const byTitle = (title: string) => {
      const step = steps.find((each) => each.title === title);
      if (!step) throw new Error(`The plan has no step "${title}"`);
      return step;
    };
    const userManual = byTitle("Write the user manual");
    expect(userManual.optional).toBe(true);
    const requirements = byTitle("Write the requirements");
    expect(requirements.optional).toBeUndefined();
    expect(byTitle("Design the look").approval).toBe("optional");

    const decline = (id: string) => `${p.path}/plan/steps/${id}/decline`;
    const byToken = await p.call(
      "POST",
      decline(userManual.id),
      {},
      await coordinatorBearer(p),
    );
    p.note("the coordinator's token declining the manual", byToken);
    expect(byToken.status).toBe(403);

    const required = await p.call("POST", decline(requirements.id));
    p.note("declining a required step", required);
    expect(required.status).toBe(409);
    expect(JSON.stringify(required.body)).toContain("cannot be declined");

    const declined = await p.call("POST", decline(userManual.id));
    expect(declined.status).toBe(200);
    const after = (await journey(p)).find((step) => step.id === userManual.id);
    expect(after?.state).toBe("skipped");
    expect(after?.summary).toBe("declined by the person");

    const handOver = await p.question();
    p.note("the hand-over screen", handOver.asked);
    const handed = await p.answer({ output: { decides: "builder" } });
    expect(handed.status).toBe(200);
    await p.filed("product_requirements", 1);
    await p.filed("design", 1);
    await p.heard("The design is chosen.");
    for (const id of ["c_manual", "c_requirements", "c_mockup"])
      p.note(`${id} returned`, p.resultOf(id).text);
    // Handed over, the design's optional approval of the requirements does not hold it back.
    expect(p.resultOf("c_mockup").text).not.toContain('"advice"');
  },
});
