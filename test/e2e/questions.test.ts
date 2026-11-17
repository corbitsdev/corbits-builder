import { expect, test } from "bun:test";
import { showsScreen } from "@corbits-builder/schemas/conversation";
import {
  call,
  execute,
  ok,
  openProject,
  results,
  say,
  turn,
  user,
} from "./support/scripted-project.ts";

const IDEA = "A sign-up sheet for the volunteers at our school fair.";
const ARIAL_AND_BITTER = {
  primary: { name: "Arial", lists: ["sans"], license: "free" },
  secondary: { name: "Bitter", lists: ["serif"], license: "free" },
};
const pickFonts = (id: string) =>
  execute(id, "designer", "pick-fonts", { proposed: { primary: "Arial" } });

test("an open screen is listed the same after the hub restarts, and answering it then resumes the coordinator with the answer", async () => {
  const project = await openProject({
    start: { idea: IDEA, title: "Volunteer Sheet" },
    runs: {
      coordinator: {
        role: "coordinator",
        turns: [
          turn(user("sign-up sheet"), pickFonts("c_fonts")),
          turn(
            results(ok("c_fonts", "execute", "Bitter")),
            say("Arial and Bitter are saved."),
          ),
        ],
      },
    },
  });
  try {
    const before = await project.question();
    const listedBefore = await project.questions();
    await project.restart();
    // What the page loads after a reload or a restart: the same questions, the screen still open.
    expect(await project.questions()).toEqual(listedBefore);
    const answered = await project.answer(before.signalName, {
      output: ARIAL_AND_BITTER,
    });
    expect(answered.status).toBe(200);
    await project.heard("Arial and Bitter are saved.");
    await project.finish();
  } finally {
    await project.close();
  }
}, 600_000);

test("a replaced coordinator's conversation keeps the earlier answered question and the open screen, closed, and the new coordinator is told both", async () => {
  const project = await openProject({
    start: { idea: IDEA, title: "Volunteer Sheet" },
    runs: {
      coordinator: {
        role: "coordinator",
        turns: [
          turn(
            user("sign-up sheet"),
            call("c_ask", "question", {
              questions: [
                {
                  header: "Audience",
                  question: "Who signs up on it?",
                  options: [
                    {
                      label: "Parents (Recommended)",
                      description: "Parents pick their own shifts.",
                    },
                    {
                      label: "Teachers",
                      description: "Teachers fill it in for their classes.",
                    },
                  ],
                },
              ],
            }),
          ),
          turn(
            results(ok("c_ask", "question", "Teachers")),
            pickFonts("c_fonts"),
          ),
        ],
      },
      replacement: {
        role: "coordinator",
        turns: [
          turn(
            user("You asked: Who signs up on it? / Person answered: Teachers"),
            say("Picking up where we left off."),
          ),
        ],
      },
    },
  });
  try {
    const asked = await project.question();
    if (showsScreen(asked))
      throw new Error("The first question opened a screen");
    const [audience] = asked.asked.questions;
    const teachers = { [audience!.id]: ["Teachers"] };
    expect(
      (await project.answer(asked.signalName, { answers: teachers })).status,
    ).toBe(200);
    const screen = await project.until("the font picker open", async () =>
      (await project.questions()).find(
        (each) => each.status === "open" && showsScreen(each),
      ),
    );

    await project.replaceCoordinator();
    expect(await project.questions()).toMatchObject([
      {
        signalName: asked.signalName,
        status: "answered",
        answer: { answers: teachers },
      },
      { signalName: screen.signalName, status: "closed" },
    ]);
    const late = await project.answer(screen.signalName, {
      output: ARIAL_AND_BITTER,
    });
    expect(late.status).toBe(409);
    expect(
      await project.values(["look.font-primary", "look.font-secondary"]),
    ).toEqual({ "look.font-primary": null, "look.font-secondary": null });

    await project.say("Carry on.");
    await project.heard("Picking up where we left off.");
    const [briefing] = project.messages("replacement");
    expect(briefing).toContain(
      "You showed the person designer pick-fonts / Left unanswered: show it again",
    );
    await project.finish();
  } finally {
    await project.close();
  }
}, 600_000);
