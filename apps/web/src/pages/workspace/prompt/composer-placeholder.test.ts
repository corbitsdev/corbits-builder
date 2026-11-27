import { describe, expect, test } from "bun:test";
import { wording } from "../../../config.ts";
import { composerPlaceholder } from "./composer-placeholder.ts";
import type { RoomStatusFacts } from "./room-status.ts";

type Facts = Pick<RoomStatusFacts, "thinking" | "working" | "failed" | "app">;

const atWork = (doing: string) => ({ runId: `run:${doing}`, doing });
const failure = (doing: string) => ({ doing, endedAt: 1 });

function placeholder(input: {
  approvalOpen?: boolean;
  questionsOpen?: boolean;
  screenReply?: string;
  nothingFiled?: boolean;
  facts?: Partial<Facts>;
}): string {
  return composerPlaceholder({
    approvalOpen: input.approvalOpen ?? false,
    questionsOpen: input.questionsOpen ?? false,
    screenReply: input.screenReply,
    nothingFiled: input.nothingFiled ?? false,
    facts: {
      thinking: false,
      working: [],
      failed: [],
      app: null,
      ...input.facts,
    },
  });
}

describe("composer placeholder", () => {
  test("work under way beats a running app and a failure, and names no one", () => {
    expect(
      placeholder({
        facts: {
          working: [atWork("Writing the brief")],
          app: "running",
          failed: [failure("Building the app")],
        },
      }),
    ).toBe("What do you want to say…");
  });

  test("the coordinator mid-turn is work under way too", () => {
    expect(placeholder({ facts: { thinking: true, app: "running" } })).toBe(
      "What do you want to say…",
    );
  });

  test("a running app beats a failure", () => {
    expect(
      placeholder({
        nothingFiled: true,
        facts: { app: "running", failed: [failure("Writing the brief")] },
      }),
    ).toBe("What needs to change…");
  });

  test("a failed app beats an empty project", () => {
    expect(placeholder({ nothingFiled: true, facts: { app: "failed" } })).toBe(
      "What needs fixing…",
    );
  });

  test("a failed specialist beats an empty project", () => {
    expect(
      placeholder({
        nothingFiled: true,
        facts: { app: "stopped", failed: [failure("Drawing concepts")] },
      }),
    ).toBe("What needs fixing…");
  });

  test("an empty project beats the fallback", () => {
    expect(placeholder({ nothingFiled: true })).toBe("What are you making…");
  });

  test("anything else asks for a reply", () => {
    expect(placeholder({ facts: { app: "stopped" } })).toBe(
      "What do you want to say…",
    );
  });

  test("an open approval keeps the approval placeholder", () => {
    expect(
      placeholder({
        approvalOpen: true,
        nothingFiled: true,
        facts: {
          working: [atWork("Building the app")],
          app: "failed",
          failed: [failure("Building the app")],
        },
      }),
    ).toBe(wording.approval.composerPlaceholder);
  });

  test("open questions point at the card, after an open approval", () => {
    const facts = { working: [atWork("Building the app")] };
    expect(placeholder({ questionsOpen: true, facts })).toBe(
      wording.questions.composerPlaceholder,
    );
    expect(
      placeholder({ approvalOpen: true, questionsOpen: true, facts }),
    ).toBe(wording.approval.composerPlaceholder);
  });
});
