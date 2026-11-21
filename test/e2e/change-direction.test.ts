import { expect, test } from "bun:test";
import {
  call,
  execute,
  ok,
  openProject,
  refused,
  results,
  say,
  turn,
  user,
  type ScriptedProject,
} from "./support/scripted-project.ts";

const IDEA = "A reading list where I track the books my book club picks.";
const CHANGE = "Forget the web app, make it a phone app.";
const PROTECTED = "protected_plan_step_removed";
const UNDER_WAY = '"Write the user manual" is part of a plan that is under way';
const AWAITS_APPROVAL =
  '"Design the look" is waiting for the person\'s approval';
const DROPPED = ["report", "build-plan", "build"];
const FILED = "The requirements are filed.";

// The web app plan's steps, under ids the scripted coordinator can name.
const WEB_APP = {
  id: "web-app",
  title: "A web app",
  plan: "build-web-app",
  steps: [
    {
      id: "requirements",
      title: "Write the requirements",
      plugin: "writer",
      action: "write-requirements",
      input: {},
      askFirst: false,
    },
    {
      id: "design",
      title: "Design the look",
      plugin: "designer",
      action: "mockup",
      input: {},
      askFirst: false,
      approval: { of: ["product_requirements"], when: "optional" },
    },
    {
      id: "report",
      title: "Write the user manual",
      plugin: "writer",
      action: "write",
      input: {},
      askFirst: false,
    },
    {
      id: "build-plan",
      title: "Write the build plan",
      plugin: "writer",
      action: "write-build-plan",
      input: {},
      askFirst: false,
      approval: { of: ["product_requirements"], when: "optional" },
    },
    {
      id: "build",
      title: "Build the app",
      plugin: "coder",
      action: "build",
      input: {},
      askFirst: false,
      approval: { of: ["build_plan", "design"], when: "optional" },
    },
  ],
};

const remove = (id: string, stepIds: string[]) =>
  call(id, "plan", { operation: "remove", stepIds });
const propose = (id: string) =>
  execute(id, "project", "change-direction", {
    stepIds: DROPPED,
    instead: "Plan and build a phone app instead.",
  });

// Each plan step's id and where it stands, as the person reads the plan.
const steps = async ({ hub, tenantId, projectId }: ScriptedProject) =>
  (await hub.client.projectPlan(tenantId, projectId)).steps
    .flatMap((step) => ("steps" in step ? step.steps : [step]))
    .map(({ id, state }) => ({ id, state }));

test("on a plan under way, a change of direction the person turns down leaves the plan as it was, and one they agree to lets the coordinator drop the steps it named and no others", async () => {
  const project = await openProject({
    start: { idea: IDEA, title: "Reading List" },
    runs: {
      coordinator: {
        role: "coordinator",
        turns: [
          turn(user("reading list"), say("Tell me what to change.")),
          turn(
            user("Write the requirements"),
            call("c_requirements", "execute", {
              plugin: "writer",
              action: "write-requirements",
              input: { instruction: IDEA },
              step: "requirements",
            }),
          ),
          turn(
            results(ok("c_requirements", "execute")),
            say("The writer is on it."),
          ),
          turn(user(FILED), say("The requirements are written.")),
          turn(user(CHANGE), remove("c_report", ["report"])),
          turn(
            results(refused("c_report", "plan", UNDER_WAY)),
            remove("c_remove", DROPPED),
          ),
          turn(
            results(refused("c_remove", "plan", PROTECTED)),
            execute("c_build", "coder", "build", {
              instruction: "Build the reading list the book club asked for.",
            }),
          ),
          turn(
            results(
              refused(
                "c_build",
                "execute",
                'The plan step "Build the app" asks for the person\'s go-ahead first',
              ),
            ),
            propose("c_no"),
          ),
          turn(results(ok("c_no", "execute")), remove("c_again", DROPPED)),
          turn(
            results(refused("c_again", "plan", PROTECTED)),
            propose("c_yes"),
          ),
          // The coordinator waits here so the cancelled steps can be read before it removes them.
          turn(results(ok("c_yes", "execute")), say("Say go and I drop them.")),
          turn(user("Go"), remove("c_drop", DROPPED)),
          turn(results(ok("c_drop", "plan")), remove("c_design", ["design"])),
          turn(
            results(refused("c_design", "plan", AWAITS_APPROVAL)),
            say("The design stays on the plan."),
          ),
        ],
      },
      writer: {
        role: "writer",
        turns: [
          turn(
            user(),
            call("w_file", "write_artifact", {
              title: "Reading list requirements",
              content:
                "## In short\n- Members see every book the club picked.\n\n## What it does\nLists the club's picks in the order they were chosen.",
            }),
          ),
          turn(results(ok("w_file", "write_artifact")), say(FILED)),
        ],
      },
    },
  });
  try {
    await project.heard("Tell me what to change.");
    const saved = await project.call("PUT", `${project.path}/plan`, {
      steps: [WEB_APP],
    });
    expect(saved.status).toBe(200);
    await project.say("Write the requirements.");
    await project.heard("The requirements are written.");
    const before = await steps(project);
    expect(before).toContainEqual({ id: "requirements", state: "done" });
    expect(before).toContainEqual({ id: "report", state: "not_started" });
    await project.say(CHANGE);

    const declined = await project.question();
    expect(await steps(project)).toEqual(before);
    expect(
      (await project.answer(declined.signalName, { output: { agreed: null } }))
        .status,
    ).toBe(200);

    // The coordinator's remove after the no was refused before it proposed again.
    const agreed = await project.until("the proposal opened again", async () =>
      (await project.questions()).find(
        (asked) =>
          asked.status === "open" && asked.signalName !== declined.signalName,
      ),
    );
    expect(JSON.parse(project.resultOf("c_no").text)).toEqual({
      output: { agreed: null },
    });
    expect(await steps(project)).toEqual(before);

    expect(
      (await project.answer(agreed.signalName, { output: { agreed: DROPPED } }))
        .status,
    ).toBe(200);
    await project.heard("Say go and I drop them.");
    expect(await steps(project)).toEqual(
      before.map(({ id, state }) => ({
        id,
        state: DROPPED.includes(id) ? "cancelled" : state,
      })),
    );

    await project.say("Go");
    await project.heard("The design stays on the plan.");
    expect(await steps(project)).toEqual(
      before.filter(({ id }) => !DROPPED.includes(id)),
    );
    await project.finish();
  } finally {
    await project.close();
  }
}, 600_000);
